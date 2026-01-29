//! Phase 2: Metadata extraction using lofty.
//!
//! Extracts audio metadata from files using the lofty crate.
//! Supports parallel extraction using rayon.

use lofty::prelude::*;
use lofty::probe::Probe;
use rayon::prelude::*;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use crate::scanner::fingerprint::FileFingerprint;
use crate::scanner::{ExtractedMetadata, ScanResult};

/// Extract metadata from a single audio file
pub fn extract_metadata(filepath: &str) -> ScanResult<ExtractedMetadata> {
    let path = Path::new(filepath);

    // Get file fingerprint
    let fingerprint = FileFingerprint::from_path(path).unwrap_or(FileFingerprint {
        mtime_ns: None,
        size: 0,
        inode: None,
    });

    let mut metadata = ExtractedMetadata {
        filepath: filepath.to_string(),
        file_size: fingerprint.size,
        file_mtime_ns: fingerprint.mtime_ns,
        file_inode: fingerprint.inode,
        ..Default::default()
    };

    // Try to read audio file
    let tagged_file = match Probe::open(path) {
        Ok(probe) => match probe.read() {
            Ok(file) => file,
            Err(e) => {
                // Use filename as title if we can't read the file
                metadata.title = Some(
                    path.file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("Unknown")
                        .to_string(),
                );
                return Err(crate::scanner::ScanError::Metadata(format!(
                    "Failed to read file: {}",
                    e
                )));
            }
        },
        Err(e) => {
            metadata.title = Some(
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown")
                    .to_string(),
            );
            return Err(crate::scanner::ScanError::Metadata(format!(
                "Failed to open file: {}",
                e
            )));
        }
    };

    // Get audio properties
    let properties = tagged_file.properties();
    metadata.duration = Some(properties.duration().as_secs_f64());
    metadata.bitrate = properties.audio_bitrate();
    metadata.sample_rate = properties.sample_rate();
    metadata.channels = properties.channels();

    // Get tag (primary or first available)
    if let Some(tag) = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
    {
        metadata.title = tag.title().map(|s| s.to_string());
        metadata.artist = tag.artist().map(|s| s.to_string());
        metadata.album = tag.album().map(|s| s.to_string());
        metadata.album_artist = tag.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string());

        // Track number can be in format "1" or "1/10"
        metadata.track_number = tag.track().map(|n| n.to_string());
        metadata.track_total = tag.track_total().map(|n| n.to_string());

        metadata.disc_number = tag.disk();
        metadata.disc_total = tag.disk_total();

        // Year/date
        metadata.date = tag.year().map(|y| y.to_string());

        metadata.genre = tag.genre().map(|s| s.to_string());
    }

    // Use filename as title if no title found
    if metadata.title.is_none() {
        metadata.title = Some(
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string(),
        );
    }

    Ok(metadata)
}

/// Extract metadata from a file, returning default metadata on error
pub fn extract_metadata_or_default(filepath: &str) -> ExtractedMetadata {
    match extract_metadata(filepath) {
        Ok(metadata) => metadata,
        Err(_) => {
            let path = Path::new(filepath);
            let fingerprint =
                FileFingerprint::from_path(path).unwrap_or(FileFingerprint::from_db(None, 0));

            ExtractedMetadata {
                filepath: filepath.to_string(),
                title: Some(
                    path.file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("Unknown")
                        .to_string(),
                ),
                file_size: fingerprint.size,
                file_mtime_ns: fingerprint.mtime_ns,
                ..Default::default()
            }
        }
    }
}

/// Extract metadata from multiple files in parallel using rayon
///
/// # Arguments
/// * `filepaths` - List of file paths to process
/// * `progress_fn` - Optional progress callback (completed_count, total)
///
/// # Returns
/// Vector of extracted metadata (one per file, in same order as input)
pub fn extract_metadata_parallel<F>(
    filepaths: &[(String, FileFingerprint)],
    progress_fn: Option<F>,
) -> Vec<ExtractedMetadata>
where
    F: Fn(usize, usize) + Sync,
{
    if filepaths.is_empty() {
        return Vec::new();
    }

    let total = filepaths.len();
    let completed = Arc::new(AtomicUsize::new(0));

    let results: Vec<ExtractedMetadata> = filepaths
        .par_iter()
        .map(|(filepath, fingerprint)| {
            let mut metadata = extract_metadata_or_default(filepath);

            // Ensure fingerprint is set from inventory
            metadata.file_size = fingerprint.size;
            metadata.file_mtime_ns = fingerprint.mtime_ns;
            metadata.file_inode = fingerprint.inode;

            // Update progress
            let count = completed.fetch_add(1, Ordering::Relaxed) + 1;
            if let Some(ref f) = progress_fn {
                f(count, total);
            }

            metadata
        })
        .collect();

    results
}

/// Extract metadata from multiple files serially (for small batches)
pub fn extract_metadata_serial<F>(
    filepaths: &[(String, FileFingerprint)],
    mut progress_fn: Option<F>,
) -> Vec<ExtractedMetadata>
where
    F: FnMut(usize, usize),
{
    let total = filepaths.len();
    let mut results = Vec::with_capacity(total);

    for (idx, (filepath, fingerprint)) in filepaths.iter().enumerate() {
        let mut metadata = extract_metadata_or_default(filepath);

        // Ensure fingerprint is set from inventory
        metadata.file_size = fingerprint.size;
        metadata.file_mtime_ns = fingerprint.mtime_ns;
        metadata.file_inode = fingerprint.inode;

        results.push(metadata);

        if let Some(ref mut f) = progress_fn {
            f(idx + 1, total);
        }
    }

    results
}

/// Smart extraction that chooses parallel or serial based on batch size
pub fn extract_metadata_batch<F>(
    filepaths: &[(String, FileFingerprint)],
    progress_fn: Option<F>,
) -> Vec<ExtractedMetadata>
where
    F: Fn(usize, usize) + Sync,
{
    // Use serial for small batches (rayon overhead not worth it)
    if filepaths.len() < 20 {
        // Convert progress fn to FnMut for serial
        let progress = progress_fn.map(|f| {
            move |current: usize, total: usize| {
                f(current, total);
            }
        });

        // Need to use a different approach for serial since we have Fn not FnMut
        let total = filepaths.len();
        let mut results = Vec::with_capacity(total);

        for (idx, (filepath, fingerprint)) in filepaths.iter().enumerate() {
            let mut metadata = extract_metadata_or_default(filepath);
            metadata.file_size = fingerprint.size;
            metadata.file_mtime_ns = fingerprint.mtime_ns;
            metadata.file_inode = fingerprint.inode;
            results.push(metadata);

            if let Some(ref f) = progress {
                f(idx + 1, total);
            }
        }

        results
    } else {
        extract_metadata_parallel(filepaths, progress_fn)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_metadata_nonexistent_file() {
        let result = extract_metadata("/nonexistent/file.mp3");
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_metadata_or_default_nonexistent() {
        let metadata = extract_metadata_or_default("/nonexistent/file.mp3");

        assert_eq!(metadata.filepath, "/nonexistent/file.mp3");
        assert!(metadata.title.is_some()); // Should use filename as title
        assert_eq!(metadata.title.unwrap(), "file");
    }

    #[test]
    fn test_extract_metadata_parallel_empty() {
        let results = extract_metadata_parallel(&[], None::<fn(usize, usize)>);
        assert!(results.is_empty());
    }
}
