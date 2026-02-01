use lofty::config::WriteOptions;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::Tag;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct TrackMetadata {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub track_total: Option<u32>,
    pub disc_number: Option<u32>,
    pub disc_total: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub duration_ms: Option<u64>,
    pub format: Option<String>,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
}

#[derive(Debug, Deserialize)]
pub struct MetadataUpdate {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub track_total: Option<u32>,
    pub disc_number: Option<u32>,
    pub disc_total: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
}

#[tauri::command]
pub fn get_track_metadata(path: String) -> Result<TrackMetadata, String> {
    let file_path = Path::new(&path);
    
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    let tagged_file = Probe::open(file_path)
        .map_err(|e| format!("Failed to open file: {}", e))?
        .read()
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());
    let properties = tagged_file.properties();

    let format = match tagged_file.file_type() {
        lofty::file::FileType::Aac => "AAC",
        lofty::file::FileType::Aiff => "AIFF",
        lofty::file::FileType::Ape => "APE",
        lofty::file::FileType::Flac => "FLAC",
        lofty::file::FileType::Mpeg => "MP3",
        lofty::file::FileType::Mp4 => "M4A",
        lofty::file::FileType::Mpc => "MPC",
        lofty::file::FileType::Opus => "Opus",
        lofty::file::FileType::Vorbis => "Ogg Vorbis",
        lofty::file::FileType::Speex => "Speex",
        lofty::file::FileType::Wav => "WAV",
        lofty::file::FileType::WavPack => "WavPack",
        _ => "Unknown",
    };

    let (title, artist, album, album_artist, track_number, track_total, disc_number, disc_total, year, genre) =
        if let Some(tag) = tag {
            (
                tag.title().map(|s| s.to_string()),
                tag.artist().map(|s| s.to_string()),
                tag.album().map(|s| s.to_string()),
                tag.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string()),
                tag.track(),
                tag.track_total(),
                tag.disk(),
                tag.disk_total(),
                tag.year(),
                tag.genre().map(|s| s.to_string()),
            )
        } else {
            (None, None, None, None, None, None, None, None, None, None)
        };

    Ok(TrackMetadata {
        path,
        title,
        artist,
        album,
        album_artist,
        track_number,
        track_total,
        disc_number,
        disc_total,
        year,
        genre,
        duration_ms: Some(properties.duration().as_millis() as u64),
        format: Some(format.to_string()),
        bitrate: properties.audio_bitrate(),
        sample_rate: properties.sample_rate(),
        channels: properties.channels(),
    })
}

#[tauri::command]
pub fn save_track_metadata(update: MetadataUpdate) -> Result<TrackMetadata, String> {
    let file_path = Path::new(&update.path);
    
    if !file_path.exists() {
        return Err(format!("File not found: {}", update.path));
    }

    let mut tagged_file = Probe::open(file_path)
        .map_err(|e| format!("Failed to open file: {}", e))?
        .read()
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let tag = match tagged_file.primary_tag_mut() {
        Some(primary_tag) => primary_tag,
        None => {
            if let Some(first_tag) = tagged_file.first_tag_mut() {
                first_tag
            } else {
                let tag_type = tagged_file.primary_tag_type();
                tagged_file.insert_tag(Tag::new(tag_type));
                tagged_file.primary_tag_mut().unwrap()
            }
        }
    };

    if let Some(title) = &update.title {
        tag.set_title(title.clone());
    }
    if let Some(artist) = &update.artist {
        tag.set_artist(artist.clone());
    }
    if let Some(album) = &update.album {
        tag.set_album(album.clone());
    }
    if let Some(album_artist) = &update.album_artist {
        tag.insert(lofty::tag::TagItem::new(
            ItemKey::AlbumArtist,
            lofty::tag::ItemValue::Text(album_artist.clone()),
        ));
    }
    if let Some(track) = update.track_number {
        tag.set_track(track);
    }
    if let Some(total) = update.track_total {
        tag.set_track_total(total);
    }
    if let Some(disc) = update.disc_number {
        tag.set_disk(disc);
    }
    if let Some(total) = update.disc_total {
        tag.set_disk_total(total);
    }
    if let Some(year) = update.year {
        tag.set_year(year);
    }
    if let Some(genre) = &update.genre {
        tag.set_genre(genre.clone());
    }

    tag.save_to_path(&update.path, WriteOptions::default())
        .map_err(|e| format!("Failed to save metadata: {}", e))?;

    get_track_metadata(update.path)
}

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // TrackMetadata struct tests
    // =========================================================================

    #[test]
    fn test_track_metadata_serialization() {
        let metadata = TrackMetadata {
            path: "/music/test.mp3".to_string(),
            title: Some("Test Song".to_string()),
            artist: Some("Test Artist".to_string()),
            album: Some("Test Album".to_string()),
            album_artist: Some("Test Album Artist".to_string()),
            track_number: Some(1),
            track_total: Some(12),
            disc_number: Some(1),
            disc_total: Some(2),
            year: Some(2024),
            genre: Some("Rock".to_string()),
            duration_ms: Some(180000),
            format: Some("MP3".to_string()),
            bitrate: Some(320),
            sample_rate: Some(44100),
            channels: Some(2),
        };

        let json = serde_json::to_string(&metadata).unwrap();
        assert!(json.contains("\"path\":\"/music/test.mp3\""));
        assert!(json.contains("\"title\":\"Test Song\""));
        assert!(json.contains("\"artist\":\"Test Artist\""));
        assert!(json.contains("\"album\":\"Test Album\""));
        assert!(json.contains("\"track_number\":1"));
        assert!(json.contains("\"duration_ms\":180000"));
    }

    #[test]
    fn test_track_metadata_deserialization() {
        let json = r#"{
            "path": "/test.flac",
            "title": "FLAC Song",
            "artist": "FLAC Artist",
            "album": null,
            "album_artist": null,
            "track_number": null,
            "track_total": null,
            "disc_number": null,
            "disc_total": null,
            "year": 2020,
            "genre": "Electronic",
            "duration_ms": 240000,
            "format": "FLAC",
            "bitrate": null,
            "sample_rate": 48000,
            "channels": 2
        }"#;

        let metadata: TrackMetadata = serde_json::from_str(json).unwrap();
        assert_eq!(metadata.path, "/test.flac");
        assert_eq!(metadata.title, Some("FLAC Song".to_string()));
        assert_eq!(metadata.year, Some(2020));
        assert_eq!(metadata.format, Some("FLAC".to_string()));
        assert!(metadata.album.is_none());
    }

    #[test]
    fn test_track_metadata_minimal() {
        let metadata = TrackMetadata {
            path: "/audio/unknown.mp3".to_string(),
            title: None,
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            track_total: None,
            disc_number: None,
            disc_total: None,
            year: None,
            genre: None,
            duration_ms: None,
            format: None,
            bitrate: None,
            sample_rate: None,
            channels: None,
        };

        let json = serde_json::to_string(&metadata).unwrap();
        assert!(json.contains("\"path\":\"/audio/unknown.mp3\""));
        assert!(json.contains("\"title\":null"));
    }

    #[test]
    fn test_track_metadata_debug() {
        let metadata = TrackMetadata {
            path: "/debug/test.mp3".to_string(),
            title: Some("Debug Test".to_string()),
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            track_total: None,
            disc_number: None,
            disc_total: None,
            year: None,
            genre: None,
            duration_ms: None,
            format: None,
            bitrate: None,
            sample_rate: None,
            channels: None,
        };

        let debug_str = format!("{:?}", metadata);
        assert!(debug_str.contains("TrackMetadata"));
        assert!(debug_str.contains("Debug Test"));
    }

    // =========================================================================
    // MetadataUpdate struct tests
    // =========================================================================

    #[test]
    fn test_metadata_update_deserialization() {
        let json = r#"{
            "path": "/music/update.mp3",
            "title": "New Title",
            "artist": "New Artist"
        }"#;

        let update: MetadataUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(update.path, "/music/update.mp3");
        assert_eq!(update.title, Some("New Title".to_string()));
        assert_eq!(update.artist, Some("New Artist".to_string()));
        assert!(update.album.is_none());
    }

    #[test]
    fn test_metadata_update_full() {
        let json = r#"{
            "path": "/music/full.mp3",
            "title": "Full Title",
            "artist": "Full Artist",
            "album": "Full Album",
            "album_artist": "Full Album Artist",
            "track_number": 5,
            "track_total": 10,
            "disc_number": 2,
            "disc_total": 3,
            "year": 2023,
            "genre": "Jazz"
        }"#;

        let update: MetadataUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(update.path, "/music/full.mp3");
        assert_eq!(update.track_number, Some(5));
        assert_eq!(update.track_total, Some(10));
        assert_eq!(update.disc_number, Some(2));
        assert_eq!(update.disc_total, Some(3));
        assert_eq!(update.year, Some(2023));
        assert_eq!(update.genre, Some("Jazz".to_string()));
    }

    #[test]
    fn test_metadata_update_minimal() {
        let json = r#"{"path": "/minimal.mp3"}"#;

        let update: MetadataUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(update.path, "/minimal.mp3");
        assert!(update.title.is_none());
        assert!(update.artist.is_none());
        assert!(update.album.is_none());
        assert!(update.track_number.is_none());
    }

    #[test]
    fn test_metadata_update_debug() {
        let update = MetadataUpdate {
            path: "/debug.mp3".to_string(),
            title: Some("Debug".to_string()),
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            track_total: None,
            disc_number: None,
            disc_total: None,
            year: None,
            genre: None,
        };

        let debug_str = format!("{:?}", update);
        assert!(debug_str.contains("MetadataUpdate"));
        assert!(debug_str.contains("Debug"));
    }

    // =========================================================================
    // Format type tests
    // =========================================================================

    #[test]
    fn test_supported_formats() {
        let formats = ["AAC", "AIFF", "APE", "FLAC", "MP3", "M4A", "MPC", "Opus", "Ogg Vorbis", "Speex", "WAV", "WavPack"];

        for format in formats {
            let metadata = TrackMetadata {
                path: format!("/test.{}", format.to_lowercase()),
                title: None,
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                track_total: None,
                disc_number: None,
                disc_total: None,
                year: None,
                genre: None,
                duration_ms: None,
                format: Some(format.to_string()),
                bitrate: None,
                sample_rate: None,
                channels: None,
            };
            assert_eq!(metadata.format, Some(format.to_string()));
        }
    }

    // =========================================================================
    // Bitrate and sample rate tests
    // =========================================================================

    #[test]
    fn test_common_bitrates() {
        let bitrates: [u32; 6] = [128, 192, 256, 320, 1411, 2822]; // CBR MP3, lossy, lossless

        for bitrate in bitrates {
            let metadata = TrackMetadata {
                path: "/test.mp3".to_string(),
                title: None,
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                track_total: None,
                disc_number: None,
                disc_total: None,
                year: None,
                genre: None,
                duration_ms: None,
                format: None,
                bitrate: Some(bitrate),
                sample_rate: None,
                channels: None,
            };
            assert_eq!(metadata.bitrate, Some(bitrate));
        }
    }

    #[test]
    fn test_common_sample_rates() {
        let sample_rates: [u32; 5] = [22050, 44100, 48000, 88200, 96000];

        for rate in sample_rates {
            let metadata = TrackMetadata {
                path: "/test.flac".to_string(),
                title: None,
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                track_total: None,
                disc_number: None,
                disc_total: None,
                year: None,
                genre: None,
                duration_ms: None,
                format: None,
                bitrate: None,
                sample_rate: Some(rate),
                channels: None,
            };
            assert_eq!(metadata.sample_rate, Some(rate));
        }
    }

    #[test]
    fn test_channel_configurations() {
        // Mono, Stereo, 5.1 surround
        let channels: [u8; 3] = [1, 2, 6];

        for ch in channels {
            let metadata = TrackMetadata {
                path: "/test.wav".to_string(),
                title: None,
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                track_total: None,
                disc_number: None,
                disc_total: None,
                year: None,
                genre: None,
                duration_ms: None,
                format: None,
                bitrate: None,
                sample_rate: None,
                channels: Some(ch),
            };
            assert_eq!(metadata.channels, Some(ch));
        }
    }

    // =========================================================================
    // Unicode and special character tests
    // =========================================================================

    #[test]
    fn test_unicode_metadata() {
        let metadata = TrackMetadata {
            path: "/music/日本語/テスト.mp3".to_string(),
            title: Some("日本語タイトル".to_string()),
            artist: Some("アーティスト名".to_string()),
            album: Some("アルバム名".to_string()),
            album_artist: None,
            track_number: None,
            track_total: None,
            disc_number: None,
            disc_total: None,
            year: None,
            genre: Some("J-Pop".to_string()),
            duration_ms: None,
            format: None,
            bitrate: None,
            sample_rate: None,
            channels: None,
        };

        let json = serde_json::to_string(&metadata).unwrap();
        let deserialized: TrackMetadata = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.title, Some("日本語タイトル".to_string()));
        assert_eq!(deserialized.artist, Some("アーティスト名".to_string()));
    }

    #[test]
    fn test_special_characters_in_metadata() {
        let metadata = TrackMetadata {
            path: "/music/Artist & Band/Track \"Special\".mp3".to_string(),
            title: Some("Track \"Special\" & <Cool>".to_string()),
            artist: Some("Artist & Band".to_string()),
            album: None,
            album_artist: None,
            track_number: None,
            track_total: None,
            disc_number: None,
            disc_total: None,
            year: None,
            genre: None,
            duration_ms: None,
            format: None,
            bitrate: None,
            sample_rate: None,
            channels: None,
        };

        let json = serde_json::to_string(&metadata).unwrap();
        let deserialized: TrackMetadata = serde_json::from_str(&json).unwrap();

        assert!(deserialized.title.as_ref().unwrap().contains("&"));
        assert!(deserialized.path.contains("&"));
    }
}
