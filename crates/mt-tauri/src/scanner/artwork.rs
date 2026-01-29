//! Artwork extraction for audio files.
//!
//! Supports extracting embedded artwork from audio files and
//! finding folder-based artwork (cover.jpg, folder.jpg, etc.)

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use lofty::prelude::*;
use lofty::probe::Probe;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Standard filenames to look for folder artwork (case-insensitive)
pub const ARTWORK_FILENAMES: &[&str] = &[
    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "folder.jpg",
    "folder.jpeg",
    "folder.png",
    "album.jpg",
    "album.jpeg",
    "album.png",
    "front.jpg",
    "front.jpeg",
    "front.png",
    "artwork.jpg",
    "artwork.jpeg",
    "artwork.png",
];

/// Extracted artwork data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artwork {
    /// Base64-encoded image data
    pub data: String,
    /// MIME type (e.g., "image/jpeg", "image/png")
    pub mime_type: String,
    /// Source of the artwork ("embedded" or "folder")
    pub source: String,
    /// For folder artwork, the filename found
    pub filename: Option<String>,
}

/// Extract embedded artwork from an audio file
pub fn get_embedded_artwork(filepath: &str) -> Option<Artwork> {
    let path = Path::new(filepath);

    let tagged_file = Probe::open(path).ok()?.read().ok()?;

    // Try primary tag first, then any tag
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;

    // Get pictures from the tag
    let pictures = tag.pictures();
    if pictures.is_empty() {
        return None;
    }

    // Use the first picture (typically front cover)
    let picture = &pictures[0];

    let mime_type = match picture.mime_type() {
        Some(lofty::picture::MimeType::Jpeg) => "image/jpeg",
        Some(lofty::picture::MimeType::Png) => "image/png",
        Some(lofty::picture::MimeType::Gif) => "image/gif",
        Some(lofty::picture::MimeType::Bmp) => "image/bmp",
        Some(lofty::picture::MimeType::Tiff) => "image/tiff",
        _ => "image/jpeg", // Default
    };

    Some(Artwork {
        data: BASE64.encode(picture.data()),
        mime_type: mime_type.to_string(),
        source: "embedded".to_string(),
        filename: None,
    })
}

/// Find folder-based artwork in the same directory as the audio file
pub fn get_folder_artwork(filepath: &str) -> Option<Artwork> {
    let path = Path::new(filepath);
    let folder = path.parent()?;

    // Try exact filenames first
    for filename in ARTWORK_FILENAMES {
        let artwork_path = folder.join(filename);
        if artwork_path.exists()
            && let Ok(data) = fs::read(&artwork_path) {
                let ext = artwork_path.extension()?.to_str()?.to_lowercase();
                let mime_type = match ext.as_str() {
                    "jpg" | "jpeg" => "image/jpeg",
                    "png" => "image/png",
                    "gif" => "image/gif",
                    "bmp" => "image/bmp",
                    _ => "image/jpeg",
                };

                return Some(Artwork {
                    data: BASE64.encode(&data),
                    mime_type: mime_type.to_string(),
                    source: "folder".to_string(),
                    filename: Some(filename.to_string()),
                });
            }
    }

    // Try case-insensitive search
    let folder_entries: Vec<_> = fs::read_dir(folder).ok()?.filter_map(|e| e.ok()).collect();

    for entry in &folder_entries {
        let entry_name = entry.file_name();
        let entry_name_lower = entry_name.to_string_lossy().to_lowercase();

        for filename in ARTWORK_FILENAMES {
            if entry_name_lower == *filename {
                let artwork_path = entry.path();
                if let Ok(data) = fs::read(&artwork_path) {
                    let ext = artwork_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    let mime_type = match ext.as_str() {
                        "jpg" | "jpeg" => "image/jpeg",
                        "png" => "image/png",
                        "gif" => "image/gif",
                        "bmp" => "image/bmp",
                        _ => "image/jpeg",
                    };

                    return Some(Artwork {
                        data: BASE64.encode(&data),
                        mime_type: mime_type.to_string(),
                        source: "folder".to_string(),
                        filename: Some(entry_name.to_string_lossy().to_string()),
                    });
                }
            }
        }
    }

    None
}

/// Get artwork for an audio file, trying embedded first then folder-based
pub fn get_artwork(filepath: &str) -> Option<Artwork> {
    // Try embedded artwork first
    if let Some(artwork) = get_embedded_artwork(filepath) {
        return Some(artwork);
    }

    // Fall back to folder-based artwork
    get_folder_artwork(filepath)
}

/// Get artwork data URL for use in HTML/CSS
pub fn get_artwork_data_url(filepath: &str) -> Option<String> {
    let artwork = get_artwork(filepath)?;
    Some(format!("data:{};base64,{}", artwork.mime_type, artwork.data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_get_embedded_artwork_nonexistent() {
        let result = get_embedded_artwork("/nonexistent/file.mp3");
        assert!(result.is_none());
    }

    #[test]
    fn test_get_folder_artwork() {
        let dir = tempdir().unwrap();

        // Create a fake cover.jpg
        let cover_path = dir.path().join("cover.jpg");
        let mut file = File::create(&cover_path).unwrap();
        // Write a minimal JPEG header
        file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();

        // Create a fake audio file path
        let audio_path = dir.path().join("song.mp3");
        File::create(&audio_path).unwrap();

        let artwork = get_folder_artwork(audio_path.to_str().unwrap());
        assert!(artwork.is_some());

        let art = artwork.unwrap();
        assert_eq!(art.source, "folder");
        assert_eq!(art.mime_type, "image/jpeg");
        assert_eq!(art.filename.unwrap(), "cover.jpg");
    }

    #[test]
    fn test_get_folder_artwork_case_insensitive() {
        let dir = tempdir().unwrap();

        // Create a COVER.JPG (uppercase)
        let cover_path = dir.path().join("COVER.JPG");
        let mut file = File::create(&cover_path).unwrap();
        file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();

        let audio_path = dir.path().join("song.mp3");
        File::create(&audio_path).unwrap();

        let artwork = get_folder_artwork(audio_path.to_str().unwrap());
        assert!(artwork.is_some());
    }

    #[test]
    fn test_get_folder_artwork_no_artwork() {
        let dir = tempdir().unwrap();

        let audio_path = dir.path().join("song.mp3");
        File::create(&audio_path).unwrap();

        let artwork = get_folder_artwork(audio_path.to_str().unwrap());
        assert!(artwork.is_none());
    }

    #[test]
    fn test_artwork_filenames_priority() {
        let dir = tempdir().unwrap();

        // Create multiple artwork files
        for name in &["folder.jpg", "cover.jpg"] {
            let path = dir.path().join(name);
            let mut file = File::create(&path).unwrap();
            file.write_all(name.as_bytes()).unwrap(); // Different content
        }

        let audio_path = dir.path().join("song.mp3");
        File::create(&audio_path).unwrap();

        let artwork = get_folder_artwork(audio_path.to_str().unwrap());
        assert!(artwork.is_some());

        // Should find cover.jpg first (earlier in ARTWORK_FILENAMES)
        let art = artwork.unwrap();
        assert_eq!(art.filename.unwrap(), "cover.jpg");
    }
}
