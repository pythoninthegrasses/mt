//! FFI wrapper for Zig inventory scanner.
//!
//! Provides a safe Rust interface around the Zig inventory scanner FFI.
//! This enables the 2-phase scan to use Zig's filesystem walking and
//! fingerprint comparison.

use mt_core::ffi::{
    mt_inventory_scanner_add_db_fingerprint, mt_inventory_scanner_add_path,
    mt_inventory_scanner_free, mt_inventory_scanner_get_added,
    mt_inventory_scanner_get_added_count, mt_inventory_scanner_get_deleted,
    mt_inventory_scanner_get_deleted_count, mt_inventory_scanner_get_modified,
    mt_inventory_scanner_get_modified_count, mt_inventory_scanner_get_stats,
    mt_inventory_scanner_get_unchanged, mt_inventory_scanner_get_unchanged_count,
    mt_inventory_scanner_new, mt_inventory_scanner_run, mt_inventory_scanner_set_recursive,
    FileFingerprint as FfiFingerprint, InventoryProgressCallback, InventoryScannerHandle,
    ScanStats as FfiScanStats,
};
use std::collections::HashMap;
use std::ffi::CString;

use super::fingerprint::FileFingerprint;
use super::inventory::InventoryResult;
use super::{ScanResult, ScanStats};

/// Zig-backed inventory scanner.
///
/// This provides a safe wrapper around the Zig inventory scanner FFI.
/// It's used internally by `run_inventory_zig()`.
struct ZigInventoryScanner {
    handle: InventoryScannerHandle,
}

// SAFETY: The Zig implementation doesn't share mutable state across threads
unsafe impl Send for ZigInventoryScanner {}

impl ZigInventoryScanner {
    /// Create a new inventory scanner.
    fn new() -> Option<Self> {
        let handle = unsafe { mt_inventory_scanner_new() };
        if handle.is_null() {
            None
        } else {
            Some(Self { handle })
        }
    }

    /// Set recursive mode for directory scanning.
    fn set_recursive(&self, recursive: bool) {
        unsafe { mt_inventory_scanner_set_recursive(self.handle, recursive) };
    }

    /// Add a path to scan.
    fn add_path(&self, path: &str) -> bool {
        let path_cstr = match CString::new(path) {
            Ok(s) => s,
            Err(_) => return false,
        };
        unsafe { mt_inventory_scanner_add_path(self.handle, path_cstr.as_ptr()) }
    }

    /// Add a database fingerprint for comparison.
    fn add_db_fingerprint(&self, path: &str, fp: &FileFingerprint) -> bool {
        let path_cstr = match CString::new(path) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let ffi_fp = fingerprint_to_ffi(fp);
        unsafe { mt_inventory_scanner_add_db_fingerprint(self.handle, path_cstr.as_ptr(), &ffi_fp) }
    }

    /// Run the inventory scan.
    fn run(&self, progress_callback: InventoryProgressCallback) -> bool {
        unsafe { mt_inventory_scanner_run(self.handle, progress_callback) }
    }

    /// Get count of added files.
    fn get_added_count(&self) -> usize {
        unsafe { mt_inventory_scanner_get_added_count(self.handle) }
    }

    /// Get count of modified files.
    fn get_modified_count(&self) -> usize {
        unsafe { mt_inventory_scanner_get_modified_count(self.handle) }
    }

    /// Get count of unchanged files.
    fn get_unchanged_count(&self) -> usize {
        unsafe { mt_inventory_scanner_get_unchanged_count(self.handle) }
    }

    /// Get count of deleted files.
    fn get_deleted_count(&self) -> usize {
        unsafe { mt_inventory_scanner_get_deleted_count(self.handle) }
    }

    /// Get an added file entry by index.
    fn get_added(&self, index: usize) -> Option<(String, FileFingerprint)> {
        let mut path_buf = [0u8; 4096];
        let mut path_len: u32 = 0;
        let mut ffi_fp = unsafe { std::mem::zeroed::<FfiFingerprint>() };

        let success = unsafe {
            mt_inventory_scanner_get_added(
                self.handle,
                index,
                &mut path_buf,
                &mut path_len,
                &mut ffi_fp,
            )
        };

        if success {
            let path = String::from_utf8_lossy(&path_buf[..path_len as usize]).to_string();
            let fp = fingerprint_from_ffi(&ffi_fp);
            Some((path, fp))
        } else {
            None
        }
    }

    /// Get a modified file entry by index.
    fn get_modified(&self, index: usize) -> Option<(String, FileFingerprint)> {
        let mut path_buf = [0u8; 4096];
        let mut path_len: u32 = 0;
        let mut ffi_fp = unsafe { std::mem::zeroed::<FfiFingerprint>() };

        let success = unsafe {
            mt_inventory_scanner_get_modified(
                self.handle,
                index,
                &mut path_buf,
                &mut path_len,
                &mut ffi_fp,
            )
        };

        if success {
            let path = String::from_utf8_lossy(&path_buf[..path_len as usize]).to_string();
            let fp = fingerprint_from_ffi(&ffi_fp);
            Some((path, fp))
        } else {
            None
        }
    }

    /// Get an unchanged file path by index.
    fn get_unchanged(&self, index: usize) -> Option<String> {
        let mut path_buf = [0u8; 4096];
        let mut path_len: u32 = 0;

        let success = unsafe {
            mt_inventory_scanner_get_unchanged(self.handle, index, &mut path_buf, &mut path_len)
        };

        if success {
            Some(String::from_utf8_lossy(&path_buf[..path_len as usize]).to_string())
        } else {
            None
        }
    }

    /// Get a deleted file path by index.
    fn get_deleted(&self, index: usize) -> Option<String> {
        let mut path_buf = [0u8; 4096];
        let mut path_len: u32 = 0;

        let success = unsafe {
            mt_inventory_scanner_get_deleted(self.handle, index, &mut path_buf, &mut path_len)
        };

        if success {
            Some(String::from_utf8_lossy(&path_buf[..path_len as usize]).to_string())
        } else {
            None
        }
    }

    /// Get scan statistics.
    fn get_stats(&self) -> ScanStats {
        let mut ffi_stats = unsafe { std::mem::zeroed::<FfiScanStats>() };
        unsafe { mt_inventory_scanner_get_stats(self.handle, &mut ffi_stats) };
        stats_from_ffi(&ffi_stats)
    }

    /// Collect all results into an InventoryResult.
    fn collect_results(&self) -> InventoryResult {
        let mut result = InventoryResult::default();

        // Collect added files
        let added_count = self.get_added_count();
        for i in 0..added_count {
            if let Some((path, fp)) = self.get_added(i) {
                result.added.push((path, fp));
            }
        }

        // Collect modified files
        let modified_count = self.get_modified_count();
        for i in 0..modified_count {
            if let Some((path, fp)) = self.get_modified(i) {
                result.modified.push((path, fp));
            }
        }

        // Collect unchanged files
        let unchanged_count = self.get_unchanged_count();
        for i in 0..unchanged_count {
            if let Some(path) = self.get_unchanged(i) {
                result.unchanged.push(path);
            }
        }

        // Collect deleted files
        let deleted_count = self.get_deleted_count();
        for i in 0..deleted_count {
            if let Some(path) = self.get_deleted(i) {
                result.deleted.push(path);
            }
        }

        // Get stats
        result.stats = self.get_stats();

        result
    }
}

impl Drop for ZigInventoryScanner {
    fn drop(&mut self) {
        unsafe { mt_inventory_scanner_free(self.handle) };
    }
}

/// Convert Rust FileFingerprint to FFI FileFingerprint.
fn fingerprint_to_ffi(fp: &FileFingerprint) -> FfiFingerprint {
    FfiFingerprint {
        mtime_ns: fp.mtime_ns.unwrap_or(0),
        size: fp.size,
        inode: fp.inode.unwrap_or(0),
        has_mtime: fp.mtime_ns.is_some(),
        has_inode: fp.inode.is_some(),
    }
}

/// Convert FFI FileFingerprint to Rust FileFingerprint.
fn fingerprint_from_ffi(ffi_fp: &FfiFingerprint) -> FileFingerprint {
    FileFingerprint {
        mtime_ns: if ffi_fp.has_mtime {
            Some(ffi_fp.mtime_ns)
        } else {
            None
        },
        size: ffi_fp.size,
        inode: if ffi_fp.has_inode {
            Some(ffi_fp.inode)
        } else {
            None
        },
    }
}

/// Convert FFI ScanStats to Rust ScanStats.
fn stats_from_ffi(ffi_stats: &FfiScanStats) -> ScanStats {
    ScanStats {
        visited: ffi_stats.visited as usize,
        added: ffi_stats.added as usize,
        modified: ffi_stats.modified as usize,
        unchanged: ffi_stats.unchanged as usize,
        deleted: ffi_stats.deleted as usize,
        errors: ffi_stats.errors as usize,
    }
}

/// Run inventory phase using Zig FFI.
///
/// This is a drop-in replacement for `run_inventory()` that uses Zig's
/// filesystem walking and fingerprint comparison instead of Rust's walkdir.
///
/// # Arguments
/// * `paths` - List of file or directory paths to scan
/// * `db_fingerprints` - Map of filepath -> FileFingerprint from database
/// * `recursive` - Whether to scan directories recursively
/// * `progress_fn` - Optional progress callback (visited_count)
pub fn run_inventory_zig<F>(
    paths: &[String],
    db_fingerprints: &HashMap<String, FileFingerprint>,
    recursive: bool,
    mut progress_fn: Option<F>,
) -> ScanResult<InventoryResult>
where
    F: FnMut(usize),
{
    let scanner = ZigInventoryScanner::new()
        .ok_or_else(|| super::ScanError::Metadata("Failed to create inventory scanner".into()))?;

    scanner.set_recursive(recursive);

    // Add paths to scan
    for path in paths {
        if !scanner.add_path(path) {
            return Err(super::ScanError::Metadata(format!(
                "Failed to add path: {}",
                path
            )));
        }
    }

    // Add database fingerprints
    for (path, fp) in db_fingerprints {
        if !scanner.add_db_fingerprint(path, fp) {
            // Log but don't fail - some paths might have encoding issues
            eprintln!("Warning: Failed to add db fingerprint for: {}", path);
        }
    }

    // Set up progress callback
    // Note: We can't easily pass a closure across FFI, so for now we pass None
    // The progress callback would require a trampoline function
    let callback: InventoryProgressCallback = if progress_fn.is_some() {
        // TODO: Implement trampoline for progress callback
        // For now, we don't support progress callbacks via FFI
        None
    } else {
        None
    };

    // Run the scan
    if !scanner.run(callback) {
        return Err(super::ScanError::Metadata(
            "Inventory scan failed".to_string(),
        ));
    }

    // If we have a progress callback, call it with the final count
    if let Some(ref mut f) = progress_fn {
        f(scanner.get_stats().visited);
    }

    // Collect and return results
    Ok(scanner.collect_results())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_zig_scanner_creation() {
        let scanner = ZigInventoryScanner::new();
        assert!(scanner.is_some());
    }

    #[test]
    fn test_zig_scanner_add_path() {
        let scanner = ZigInventoryScanner::new().unwrap();
        assert!(scanner.add_path("/test/path"));
    }

    #[test]
    fn test_zig_scanner_empty_scan() {
        let scanner = ZigInventoryScanner::new().unwrap();

        // Add nonexistent path
        scanner.add_path("/nonexistent/path/that/does/not/exist");

        // Run scan
        assert!(scanner.run(None));

        // Should have no results
        assert_eq!(scanner.get_added_count(), 0);
        assert_eq!(scanner.get_modified_count(), 0);
        assert_eq!(scanner.get_unchanged_count(), 0);
        assert_eq!(scanner.get_deleted_count(), 0);
    }

    #[test]
    fn test_run_inventory_zig_empty() {
        let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();
        let dir = tempdir().unwrap();

        let result = run_inventory_zig(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
            None::<fn(usize)>,
        )
        .unwrap();

        assert!(result.added.is_empty());
        assert!(result.modified.is_empty());
        assert!(result.unchanged.is_empty());
        assert!(result.deleted.is_empty());
    }

    #[test]
    fn test_run_inventory_zig_finds_new_files() {
        let dir = tempdir().unwrap();

        // Create test audio files
        let file_path = dir.path().join("song.mp3");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(b"fake mp3 content").unwrap();

        let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();

        let result = run_inventory_zig(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
            None::<fn(usize)>,
        )
        .unwrap();

        assert_eq!(result.added.len(), 1);
        assert_eq!(result.stats.added, 1);
        assert!(result.added[0].0.ends_with("song.mp3"));
    }

    #[test]
    fn test_run_inventory_zig_detects_deleted() {
        let dir = tempdir().unwrap();

        // DB has a file that doesn't exist
        let mut db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();
        db_fingerprints.insert(
            "/nonexistent/deleted_song.mp3".to_string(),
            FileFingerprint::from_db(Some(1234567890), 1000),
        );

        let result = run_inventory_zig(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
            None::<fn(usize)>,
        )
        .unwrap();

        assert_eq!(result.deleted.len(), 1);
        assert_eq!(result.stats.deleted, 1);
    }

    #[test]
    fn test_fingerprint_conversion() {
        let rust_fp = FileFingerprint {
            mtime_ns: Some(1234567890),
            size: 1000,
            inode: Some(12345),
        };

        let ffi_fp = fingerprint_to_ffi(&rust_fp);
        assert_eq!(ffi_fp.mtime_ns, 1234567890);
        assert_eq!(ffi_fp.size, 1000);
        assert_eq!(ffi_fp.inode, 12345);
        assert!(ffi_fp.has_mtime);
        assert!(ffi_fp.has_inode);

        let back = fingerprint_from_ffi(&ffi_fp);
        assert_eq!(back.mtime_ns, Some(1234567890));
        assert_eq!(back.size, 1000);
        assert_eq!(back.inode, Some(12345));
    }

    #[test]
    fn test_fingerprint_conversion_no_mtime() {
        let rust_fp = FileFingerprint {
            mtime_ns: None,
            size: 2000,
            inode: None,
        };

        let ffi_fp = fingerprint_to_ffi(&rust_fp);
        assert!(!ffi_fp.has_mtime);
        assert!(!ffi_fp.has_inode);
        assert_eq!(ffi_fp.size, 2000);

        let back = fingerprint_from_ffi(&ffi_fp);
        assert_eq!(back.mtime_ns, None);
        assert_eq!(back.inode, None);
        assert_eq!(back.size, 2000);
    }
}
