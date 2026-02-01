//! File fingerprinting for change detection.
//!
//! Uses file modification time (mtime_ns) and file size as a fingerprint
//! to detect changes without reading file contents. Also captures inode
//! for move detection on the same filesystem.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::UNIX_EPOCH;

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

use crate::scanner::ScanResult;

/// File fingerprint using mtime and size for change detection
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FileFingerprint {
    /// File modification time in nanoseconds since Unix epoch
    pub mtime_ns: Option<i64>,
    /// File size in bytes
    pub size: i64,
    /// File inode (Unix only) for move detection
    pub inode: Option<u64>,
}

impl FileFingerprint {
    /// Create a new fingerprint from file metadata
    pub fn from_path(path: &Path) -> ScanResult<Self> {
        let metadata = fs::metadata(path)?;

        let mtime_ns = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_nanos() as i64);

        let size = metadata.len() as i64;

        #[cfg(unix)]
        let inode = Some(metadata.ino());

        #[cfg(not(unix))]
        let inode = None;

        Ok(FileFingerprint {
            mtime_ns,
            size,
            inode,
        })
    }

    /// Create a fingerprint from database values
    pub fn from_db(mtime_ns: Option<i64>, size: i64) -> Self {
        FileFingerprint {
            mtime_ns,
            size,
            inode: None,
        }
    }

    /// Create a fingerprint from database values including inode
    pub fn from_db_with_inode(mtime_ns: Option<i64>, size: i64, inode: Option<u64>) -> Self {
        FileFingerprint {
            mtime_ns,
            size,
            inode,
        }
    }

    /// Check if this fingerprint matches another (ignores inode)
    pub fn matches(&self, other: &FileFingerprint) -> bool {
        self.mtime_ns == other.mtime_ns && self.size == other.size
    }
}

/// Size of chunks to read for partial content hash (64KB)
const HASH_CHUNK_SIZE: u64 = 64 * 1024;

/// Compute a partial content hash for a file.
///
/// For performance, we hash:
/// - The first 64KB of the file
/// - The last 64KB of the file (if file is larger than 128KB)
///
/// This provides a reasonable balance between speed and collision resistance.
/// Two audio files with identical first and last 64KB are extremely unlikely
/// to be different files.
///
/// Returns a hex-encoded SHA256 hash prefixed with "sha256:".
pub fn compute_content_hash(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let file_size = file.metadata()?.len();

    let mut hasher = Sha256::new();

    // Read first chunk
    let first_chunk_size = std::cmp::min(HASH_CHUNK_SIZE, file_size);
    let mut buffer = vec![0u8; first_chunk_size as usize];
    file.read_exact(&mut buffer)?;
    hasher.update(&buffer);

    // Read last chunk if file is large enough
    if file_size > HASH_CHUNK_SIZE * 2 {
        file.seek(SeekFrom::End(-(HASH_CHUNK_SIZE as i64)))?;
        let mut last_buffer = vec![0u8; HASH_CHUNK_SIZE as usize];
        file.read_exact(&mut last_buffer)?;
        hasher.update(&last_buffer);
    }

    let hash = hasher.finalize();
    Ok(format!("sha256:{:x}", hash))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_fingerprint_from_path() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.txt");

        // Create a test file
        let mut file = File::create(&file_path).unwrap();
        file.write_all(b"test content").unwrap();
        drop(file);

        let fingerprint = FileFingerprint::from_path(&file_path).unwrap();

        assert!(fingerprint.mtime_ns.is_some());
        assert_eq!(fingerprint.size, 12); // "test content" is 12 bytes
        #[cfg(unix)]
        assert!(fingerprint.inode.is_some());
    }

    #[test]
    fn test_fingerprint_matches() {
        let fp1 = FileFingerprint {
            mtime_ns: Some(1234567890),
            size: 1000,
            inode: Some(12345),
        };

        let fp2 = FileFingerprint {
            mtime_ns: Some(1234567890),
            size: 1000,
            inode: Some(99999), // Different inode - should still match
        };

        let fp3 = FileFingerprint {
            mtime_ns: Some(1234567890),
            size: 2000, // Different size
            inode: Some(12345),
        };

        let fp4 = FileFingerprint {
            mtime_ns: Some(9999999999),
            size: 1000, // Different mtime
            inode: Some(12345),
        };

        assert!(fp1.matches(&fp2));
        assert!(!fp1.matches(&fp3));
        assert!(!fp1.matches(&fp4));
    }

    #[test]
    fn test_fingerprint_from_db() {
        let fp = FileFingerprint::from_db(Some(1234567890), 5000);

        assert_eq!(fp.mtime_ns, Some(1234567890));
        assert_eq!(fp.size, 5000);
        assert_eq!(fp.inode, None);
    }

    #[test]
    fn test_fingerprint_from_db_with_inode() {
        let fp = FileFingerprint::from_db_with_inode(Some(1234567890), 5000, Some(12345));

        assert_eq!(fp.mtime_ns, Some(1234567890));
        assert_eq!(fp.size, 5000);
        assert_eq!(fp.inode, Some(12345));
    }

    #[test]
    fn test_compute_content_hash_small_file() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("small.txt");

        let mut file = File::create(&file_path).unwrap();
        file.write_all(b"small file content").unwrap();
        drop(file);

        let hash = compute_content_hash(&file_path).unwrap();
        assert!(hash.starts_with("sha256:"));
        let expected_len = "sha256:".len() + 64;
        assert_eq!(hash.len(), expected_len);

        let hash2 = compute_content_hash(&file_path).unwrap();
        assert_eq!(hash, hash2);
    }

    #[test]
    fn test_compute_content_hash_large_file() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("large.bin");

        let mut file = File::create(&file_path).unwrap();
        let chunk = vec![0xABu8; 64 * 1024];
        for _ in 0..5 {
            file.write_all(&chunk).unwrap();
        }
        drop(file);

        let hash = compute_content_hash(&file_path).unwrap();
        assert!(hash.starts_with("sha256:"));
    }

    #[test]
    fn test_compute_content_hash_different_files() {
        let dir = tempdir().unwrap();

        let file1_path = dir.path().join("file1.txt");
        let mut file1 = File::create(&file1_path).unwrap();
        file1.write_all(b"content one").unwrap();
        drop(file1);

        let file2_path = dir.path().join("file2.txt");
        let mut file2 = File::create(&file2_path).unwrap();
        file2.write_all(b"content two").unwrap();
        drop(file2);

        let hash1 = compute_content_hash(&file1_path).unwrap();
        let hash2 = compute_content_hash(&file2_path).unwrap();
        assert_ne!(hash1, hash2);
    }
}
