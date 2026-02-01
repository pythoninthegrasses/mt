//! Phase 1: Inventory - Fast filesystem walk and fingerprint comparison.
//!
//! This phase walks the filesystem, collects file stats, and compares
//! fingerprints with the database to classify files as added/modified/unchanged/deleted.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use walkdir::WalkDir;

use crate::scanner::fingerprint::FileFingerprint;
use crate::scanner::{is_audio_file, ScanResult, ScanStats};

/// Result of the inventory phase
#[derive(Debug, Default)]
pub struct InventoryResult {
    /// New files not in database (filepath, fingerprint)
    pub added: Vec<(String, FileFingerprint)>,
    /// Files with changed fingerprint (filepath, new_fingerprint)
    pub modified: Vec<(String, FileFingerprint)>,
    /// Files with unchanged fingerprint
    pub unchanged: Vec<String>,
    /// Files in DB but not on filesystem
    pub deleted: Vec<String>,
    /// Statistics
    pub stats: ScanStats,
}

/// Run inventory phase (Phase 1) on given paths.
///
/// Walks the filesystem, collects fingerprints, and compares with database
/// to determine which files need metadata extraction.
///
/// # Arguments
/// * `paths` - List of file or directory paths to scan
/// * `db_fingerprints` - Map of filepath -> (mtime_ns, file_size) from database
/// * `recursive` - Whether to scan directories recursively
/// * `progress_fn` - Optional progress callback (visited_count)
pub fn run_inventory<F>(
    paths: &[String],
    db_fingerprints: &HashMap<String, FileFingerprint>,
    recursive: bool,
    mut progress_fn: Option<F>,
) -> ScanResult<InventoryResult>
where
    F: FnMut(usize),
{
    let mut result = InventoryResult::default();
    let mut filesystem_files: HashMap<String, FileFingerprint> = HashMap::new();

    for path_str in paths {
        let path = Path::new(path_str);

        if !path.exists() {
            continue;
        }

        if path.is_file() {
            // Single file
            if is_audio_file(path) {
                match FileFingerprint::from_path(path) {
                    Ok(fingerprint) => {
                        filesystem_files.insert(path_str.clone(), fingerprint);
                        result.stats.visited += 1;

                        if let Some(ref mut f) = progress_fn {
                            f(result.stats.visited);
                        }
                    }
                    Err(_) => {
                        result.stats.errors += 1;
                    }
                }
            }
        } else if path.is_dir() {
            // Directory - scan for audio files
            let walker = if recursive {
                WalkDir::new(path).follow_links(true)
            } else {
                WalkDir::new(path).max_depth(1).follow_links(true)
            };

            for entry in walker.into_iter().filter_map(|e| e.ok()) {
                let entry_path = entry.path();

                if entry_path.is_file() && is_audio_file(entry_path) {
                    match FileFingerprint::from_path(entry_path) {
                        Ok(fingerprint) => {
                            let filepath = entry_path.to_string_lossy().to_string();
                            filesystem_files.insert(filepath, fingerprint);
                            result.stats.visited += 1;

                            if let Some(ref mut f) = progress_fn {
                                f(result.stats.visited);
                            }
                        }
                        Err(_) => {
                            result.stats.errors += 1;
                        }
                    }
                }
            }
        }
    }

    // Classify files by comparing fingerprints
    for (filepath, fs_fingerprint) in &filesystem_files {
        if let Some(db_fingerprint) = db_fingerprints.get(filepath) {
            if fs_fingerprint.matches(db_fingerprint) {
                // File exists with same fingerprint - unchanged
                result.unchanged.push(filepath.clone());
                result.stats.unchanged += 1;
            } else {
                // File exists but fingerprint changed
                result.modified.push((filepath.clone(), *fs_fingerprint));
                result.stats.modified += 1;
            }
        } else {
            // New file - not in DB
            result.added.push((filepath.clone(), *fs_fingerprint));
            result.stats.added += 1;
        }
    }

    // Find deleted files (in DB but not on filesystem)
    let filesystem_set: HashSet<&String> = filesystem_files.keys().collect();
    for db_filepath in db_fingerprints.keys() {
        if !filesystem_set.contains(db_filepath) {
            result.deleted.push(db_filepath.clone());
            result.stats.deleted += 1;
        }
    }

    Ok(result)
}

/// Run inventory on a single path (convenience function)
pub fn inventory_path<F>(
    path: &str,
    db_fingerprints: &HashMap<String, FileFingerprint>,
    recursive: bool,
    progress_fn: Option<F>,
) -> ScanResult<InventoryResult>
where
    F: FnMut(usize),
{
    run_inventory(&[path.to_string()], db_fingerprints, recursive, progress_fn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    fn create_test_file(dir: &Path, name: &str, content: &[u8]) -> String {
        let file_path = dir.join(name);
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content).unwrap();
        file_path.to_string_lossy().to_string()
    }

    #[test]
    fn test_inventory_empty_directory() {
        let dir = tempdir().unwrap();
        let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();

        let result = run_inventory(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
            None::<fn(usize)>,
        )
        .unwrap();

        assert_eq!(result.stats.visited, 0);
        assert_eq!(result.stats.added, 0);
        assert!(result.added.is_empty());
    }

    #[test]
    fn test_inventory_new_files() {
        let dir = tempdir().unwrap();

        // Create test audio files (just by extension, content doesn't matter for this test)
        create_test_file(dir.path(), "song1.mp3", b"fake mp3");
        create_test_file(dir.path(), "song2.flac", b"fake flac");
        create_test_file(dir.path(), "image.jpg", b"fake image"); // Should be ignored

        let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();

        let result = run_inventory(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
            None::<fn(usize)>,
        )
        .unwrap();

        assert_eq!(result.stats.visited, 2); // Only audio files
        assert_eq!(result.stats.added, 2);
        assert_eq!(result.added.len(), 2);
    }

    #[test]
    fn test_inventory_unchanged_files() {
        let dir = tempdir().unwrap();

        let filepath = create_test_file(dir.path(), "song.mp3", b"fake mp3");
        let fingerprint = FileFingerprint::from_path(Path::new(&filepath)).unwrap();

        let mut db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();
        db_fingerprints.insert(filepath.clone(), fingerprint);

        let result = run_inventory(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
            None::<fn(usize)>,
        )
        .unwrap();

        assert_eq!(result.stats.visited, 1);
        assert_eq!(result.stats.unchanged, 1);
        assert_eq!(result.unchanged.len(), 1);
        assert!(result.added.is_empty());
        assert!(result.modified.is_empty());
    }

    #[test]
    fn test_inventory_deleted_files() {
        let dir = tempdir().unwrap();

        // DB has a file that doesn't exist on filesystem
        let mut db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();
        db_fingerprints.insert(
            "/nonexistent/song.mp3".to_string(),
            FileFingerprint::from_db(Some(1234567890), 1000),
        );

        let result = run_inventory(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
            None::<fn(usize)>,
        )
        .unwrap();

        assert_eq!(result.stats.deleted, 1);
        assert_eq!(result.deleted.len(), 1);
    }

    #[test]
    fn test_inventory_modified_files() {
        let dir = tempdir().unwrap();

        let filepath = create_test_file(dir.path(), "song.mp3", b"fake mp3");

        // DB has different fingerprint (different size)
        let mut db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();
        db_fingerprints.insert(filepath.clone(), FileFingerprint::from_db(None, 9999));

        let result = run_inventory(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
            None::<fn(usize)>,
        )
        .unwrap();

        assert_eq!(result.stats.visited, 1);
        assert_eq!(result.stats.modified, 1);
        assert_eq!(result.modified.len(), 1);
    }

    #[test]
    fn test_inventory_non_recursive() {
        let dir = tempdir().unwrap();
        let subdir = dir.path().join("subdir");
        std::fs::create_dir(&subdir).unwrap();

        create_test_file(dir.path(), "song1.mp3", b"fake mp3");
        create_test_file(&subdir, "song2.mp3", b"fake mp3");

        let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();

        // Recursive = false should only find song1.mp3
        let result = run_inventory(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            false,
            None::<fn(usize)>,
        )
        .unwrap();

        assert_eq!(result.stats.visited, 1);
        assert_eq!(result.stats.added, 1);
    }
}
