//! Music library scanner module.
//!
//! Implements a 2-phase scanning approach for optimal performance:
//! - Phase 1 (Inventory): Fast filesystem walk + stat + DB fingerprint comparison
//! - Phase 2 (Parse): Metadata extraction only for changed files
//!
//! This enables no-op rescans to complete quickly without parsing any tags.

pub mod artwork;
pub mod artwork_cache;
pub mod artwork_cache_ffi;
#[cfg(test)]
mod benchmarks;
pub mod commands;
pub mod fingerprint;
pub mod inventory;
pub mod inventory_ffi;
pub mod metadata;
pub mod scan;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use thiserror::Error;

/// Supported audio file extensions
pub const AUDIO_EXTENSIONS: &[&str] = &[
    ".mp3", ".m4a", ".flac", ".ogg", ".wav", ".aac", ".wma", ".opus", ".ape", ".aiff",
];

/// Scanner error types
#[derive(Error, Debug)]
pub enum ScanError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Metadata extraction error: {0}")]
    Metadata(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Path not found: {0}")]
    PathNotFound(String),
}

pub type ScanResult<T> = Result<T, ScanError>;

/// Statistics from a 2-phase scan operation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScanStats {
    /// Total files visited during inventory
    pub visited: usize,
    /// New files added to library
    pub added: usize,
    /// Existing files with changed fingerprint
    pub modified: usize,
    /// Existing files with unchanged fingerprint
    pub unchanged: usize,
    /// Files in DB but not on filesystem
    pub deleted: usize,
    /// Files that failed to process
    pub errors: usize,
}

/// Extracted metadata from an audio file
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExtractedMetadata {
    pub filepath: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<String>,
    pub track_total: Option<String>,
    pub disc_number: Option<u32>,
    pub disc_total: Option<u32>,
    pub date: Option<String>,
    pub genre: Option<String>,
    pub duration: Option<f64>,
    pub file_size: i64,
    pub file_mtime_ns: Option<i64>,
    pub file_inode: Option<u64>,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
}

/// Progress event for scan operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub phase: String,
    pub current: usize,
    pub total: usize,
    pub message: Option<String>,
}

/// Check if a path has a supported audio extension
pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let ext_lower = format!(".{}", ext.to_lowercase());
            AUDIO_EXTENSIONS.contains(&ext_lower.as_str())
        })
        .unwrap_or(false)
}

/// Get supported audio extensions as a HashSet for fast lookup
pub fn audio_extensions_set() -> HashSet<&'static str> {
    AUDIO_EXTENSIONS.iter().copied().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_is_audio_file() {
        assert!(is_audio_file(Path::new("song.mp3")));
        assert!(is_audio_file(Path::new("song.MP3")));
        assert!(is_audio_file(Path::new("song.flac")));
        assert!(is_audio_file(Path::new("song.m4a")));
        assert!(is_audio_file(Path::new("song.ogg")));
        assert!(is_audio_file(Path::new("song.wav")));
        assert!(is_audio_file(Path::new("song.opus")));
        assert!(!is_audio_file(Path::new("image.jpg")));
        assert!(!is_audio_file(Path::new("document.pdf")));
        assert!(!is_audio_file(Path::new("noext")));
    }

    #[test]
    fn test_is_audio_file_with_path() {
        assert!(is_audio_file(&PathBuf::from("/music/artist/album/track.mp3")));
        assert!(is_audio_file(&PathBuf::from("/music/artist/album/track.FLAC")));
        assert!(!is_audio_file(&PathBuf::from("/music/artist/album/cover.jpg")));
    }
}
