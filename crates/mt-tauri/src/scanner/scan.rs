//! 2-phase scan orchestration.
//!
//! Coordinates the inventory and metadata extraction phases
//! for optimal scanning performance.

use std::collections::HashMap;

use crate::scanner::fingerprint::FileFingerprint;
use crate::scanner::inventory::InventoryResult;
use crate::scanner::inventory_ffi::run_inventory_zig;
use crate::scanner::metadata::extract_metadata_batch;
use crate::scanner::{ExtractedMetadata, ScanProgress, ScanResult, ScanStats};

/// Result of a complete 2-phase scan
#[derive(Debug)]
pub struct ScanResult2Phase {
    /// Metadata for newly added files
    pub added: Vec<ExtractedMetadata>,
    /// Metadata for modified files
    pub modified: Vec<ExtractedMetadata>,
    /// Paths of unchanged files
    pub unchanged: Vec<String>,
    /// Paths of deleted files (were in DB, not on filesystem)
    pub deleted: Vec<String>,
    /// Scan statistics
    pub stats: ScanStats,
}

/// Progress callback type for scan operations
pub type ProgressCallback = Box<dyn Fn(ScanProgress) + Send + Sync>;

/// Run a complete 2-phase scan
///
/// # Arguments
/// * `paths` - Paths to scan (files or directories)
/// * `db_fingerprints` - Current fingerprints from database (filepath -> fingerprint)
/// * `recursive` - Whether to scan directories recursively
/// * `progress_callback` - Optional callback for progress updates
///
/// # Returns
/// Scan result with categorized files and extracted metadata
pub fn scan_2phase(
    paths: &[String],
    db_fingerprints: &HashMap<String, FileFingerprint>,
    recursive: bool,
    progress_callback: Option<&ProgressCallback>,
) -> ScanResult<ScanResult2Phase> {
    // Phase 1: Inventory
    if let Some(cb) = progress_callback {
        cb(ScanProgress {
            phase: "inventory".to_string(),
            current: 0,
            total: 0,
            message: Some("Starting inventory phase...".to_string()),
        });
    }

    let inventory_progress = progress_callback.map(|cb| {
        move |visited: usize| {
            cb(ScanProgress {
                phase: "inventory".to_string(),
                current: visited,
                total: 0, // Unknown total during inventory
                message: None,
            });
        }
    });

    let inventory = run_inventory_zig(paths, db_fingerprints, recursive, inventory_progress)?;

    // Phase 2: Parse changed files
    let total_to_parse = inventory.added.len() + inventory.modified.len();

    if let Some(cb) = progress_callback {
        cb(ScanProgress {
            phase: "parse".to_string(),
            current: 0,
            total: total_to_parse,
            message: Some(format!(
                "Parsing {} new/modified files...",
                total_to_parse
            )),
        });
    }

    // Combine added and modified for parsing
    let all_to_parse: Vec<(String, FileFingerprint)> = inventory
        .added
        .iter()
        .chain(inventory.modified.iter())
        .cloned()
        .collect();

    let parse_progress = progress_callback.map(|cb| {
        move |current: usize, total: usize| {
            cb(ScanProgress {
                phase: "parse".to_string(),
                current,
                total,
                message: None,
            });
        }
    });

    let parsed_metadata = extract_metadata_batch(&all_to_parse, parse_progress);

    // Split results back into added and modified
    let added_count = inventory.added.len();
    let (added_metadata, modified_metadata) = parsed_metadata.split_at(added_count);

    // Final stats
    let mut stats = inventory.stats;
    stats.errors += parsed_metadata
        .iter()
        .filter(|m| m.title.is_none() || m.duration.is_none())
        .count();

    if let Some(cb) = progress_callback {
        cb(ScanProgress {
            phase: "complete".to_string(),
            current: total_to_parse,
            total: total_to_parse,
            message: Some(format!(
                "Scan complete: {} added, {} modified, {} unchanged, {} deleted",
                stats.added, stats.modified, stats.unchanged, stats.deleted
            )),
        });
    }

    Ok(ScanResult2Phase {
        added: added_metadata.to_vec(),
        modified: modified_metadata.to_vec(),
        unchanged: inventory.unchanged,
        deleted: inventory.deleted,
        stats,
    })
}

/// Quick scan that only runs inventory (no metadata extraction)
///
/// Useful for fast change detection when you only need to know
/// what changed, not the full metadata.
///
/// Note: This now uses the Zig FFI implementation for filesystem walking.
pub fn scan_inventory_only(
    paths: &[String],
    db_fingerprints: &HashMap<String, FileFingerprint>,
    recursive: bool,
) -> ScanResult<InventoryResult> {
    run_inventory_zig(paths, db_fingerprints, recursive, None::<fn(usize)>)
}

/// Build a fingerprint map from database tracks
pub fn build_fingerprint_map(
    tracks: &[(String, Option<i64>, i64)],
) -> HashMap<String, FileFingerprint> {
    tracks
        .iter()
        .map(|(filepath, mtime_ns, size)| {
            (
                filepath.clone(),
                FileFingerprint::from_db(*mtime_ns, *size),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tempfile::tempdir;

    #[test]
    fn test_scan_2phase_empty() {
        let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();
        let dir = tempdir().unwrap();

        let result = scan_2phase(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
            None,
        )
        .unwrap();

        assert!(result.added.is_empty());
        assert!(result.modified.is_empty());
        assert!(result.unchanged.is_empty());
        assert!(result.deleted.is_empty());
    }

    #[test]
    fn test_scan_2phase_with_progress_callback() {
        let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();
        let dir = tempdir().unwrap();

        let progress_count = Arc::new(AtomicUsize::new(0));
        let progress_count_clone = progress_count.clone();

        let callback: ProgressCallback = Box::new(move |progress| {
            progress_count_clone.fetch_add(1, Ordering::SeqCst);
            // Verify progress has valid phases
            assert!(
                ["inventory", "parse", "complete"].contains(&progress.phase.as_str()),
                "Invalid phase: {}",
                progress.phase
            );
        });

        let result = scan_2phase(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
            Some(&callback),
        )
        .unwrap();

        // Should have received at least inventory start and complete callbacks
        assert!(progress_count.load(Ordering::SeqCst) >= 2);
        assert!(result.added.is_empty());
    }

    #[test]
    fn test_scan_2phase_with_files_and_progress() {
        let dir = tempdir().unwrap();

        // Create a test file
        let file_path = dir.path().join("track.mp3");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(b"fake mp3 content").unwrap();

        let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();

        let phases_seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let phases_clone = phases_seen.clone();

        let callback: ProgressCallback = Box::new(move |progress| {
            phases_clone.lock().unwrap().push(progress.phase.clone());
        });

        let result = scan_2phase(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
            Some(&callback),
        )
        .unwrap();

        let phases = phases_seen.lock().unwrap();
        // Should see inventory and complete phases at minimum
        assert!(phases.contains(&"inventory".to_string()));
        assert!(phases.contains(&"complete".to_string()));

        // Should have found the mp3 file
        assert_eq!(result.stats.added, 1);
    }

    #[test]
    fn test_scan_inventory_only() {
        let dir = tempdir().unwrap();

        // Create test file
        let file_path = dir.path().join("song.mp3");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(b"fake mp3").unwrap();

        let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();

        let result = scan_inventory_only(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
        )
        .unwrap();

        assert_eq!(result.stats.added, 1);
        assert_eq!(result.added.len(), 1);
    }

    #[test]
    fn test_scan_inventory_only_multiple_files() {
        let dir = tempdir().unwrap();

        // Create multiple test files
        for name in ["track1.mp3", "track2.flac", "track3.m4a"] {
            let file_path = dir.path().join(name);
            let mut file = File::create(&file_path).unwrap();
            file.write_all(format!("content of {}", name).as_bytes())
                .unwrap();
        }

        let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();

        let result = scan_inventory_only(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
        )
        .unwrap();

        assert_eq!(result.stats.added, 3);
    }

    #[test]
    fn test_scan_inventory_only_non_recursive() {
        let dir = tempdir().unwrap();
        let subdir = dir.path().join("subdir");
        std::fs::create_dir(&subdir).unwrap();

        // File in root
        let file1 = dir.path().join("root.mp3");
        std::fs::write(&file1, b"root file").unwrap();

        // File in subdir
        let file2 = subdir.join("sub.mp3");
        std::fs::write(&file2, b"sub file").unwrap();

        let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();

        // Non-recursive scan should only find root file
        let result = scan_inventory_only(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            false, // non-recursive
        )
        .unwrap();

        assert_eq!(result.stats.added, 1);
    }

    #[test]
    fn test_build_fingerprint_map() {
        let tracks = vec![
            (
                "/music/song1.mp3".to_string(),
                Some(1234567890_i64),
                1000_i64,
            ),
            ("/music/song2.mp3".to_string(), None, 2000_i64),
        ];

        let map = build_fingerprint_map(&tracks);

        assert_eq!(map.len(), 2);
        assert_eq!(map["/music/song1.mp3"].mtime_ns, Some(1234567890));
        assert_eq!(map["/music/song1.mp3"].size, 1000);
        assert_eq!(map["/music/song2.mp3"].mtime_ns, None);
        assert_eq!(map["/music/song2.mp3"].size, 2000);
    }

    #[test]
    fn test_build_fingerprint_map_empty() {
        let tracks: Vec<(String, Option<i64>, i64)> = vec![];
        let map = build_fingerprint_map(&tracks);
        assert!(map.is_empty());
    }

    #[test]
    fn test_build_fingerprint_map_large() {
        let tracks: Vec<(String, Option<i64>, i64)> = (0..100)
            .map(|i| (format!("/music/track{}.mp3", i), Some(i as i64), (i * 1000) as i64))
            .collect();

        let map = build_fingerprint_map(&tracks);

        assert_eq!(map.len(), 100);
        assert_eq!(map["/music/track50.mp3"].mtime_ns, Some(50));
        assert_eq!(map["/music/track50.mp3"].size, 50000);
    }

    #[test]
    fn test_scan_result_2phase_debug() {
        let result = ScanResult2Phase {
            added: vec![],
            modified: vec![],
            unchanged: vec!["unchanged.mp3".to_string()],
            deleted: vec!["deleted.mp3".to_string()],
            stats: ScanStats {
                visited: 2,
                added: 0,
                modified: 0,
                unchanged: 1,
                deleted: 1,
                errors: 0,
            },
        };

        let debug_str = format!("{:?}", result);
        assert!(debug_str.contains("ScanResult2Phase"));
        assert!(debug_str.contains("unchanged"));
        assert!(debug_str.contains("deleted"));
    }

    #[test]
    fn test_progress_callback_type() {
        // Test that progress callback can be created and used
        let callback: ProgressCallback = Box::new(|_progress| {
            // No-op callback
        });

        // Verify callback can be invoked
        callback(ScanProgress {
            phase: "test".to_string(),
            current: 0,
            total: 10,
            message: Some("Testing".to_string()),
        });
    }

    #[test]
    fn test_scan_progress_struct() {
        let progress = ScanProgress {
            phase: "inventory".to_string(),
            current: 5,
            total: 10,
            message: Some("Processing files...".to_string()),
        };

        assert_eq!(progress.phase, "inventory");
        assert_eq!(progress.current, 5);
        assert_eq!(progress.total, 10);
        assert_eq!(progress.message, Some("Processing files...".to_string()));
    }

    #[test]
    fn test_scan_progress_without_message() {
        let progress = ScanProgress {
            phase: "parse".to_string(),
            current: 3,
            total: 5,
            message: None,
        };

        assert!(progress.message.is_none());
    }
}
