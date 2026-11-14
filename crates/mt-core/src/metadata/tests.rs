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
    let formats = [
        "AAC",
        "AIFF",
        "APE",
        "FLAC",
        "MP3",
        "M4A",
        "MPC",
        "Opus",
        "Ogg Vorbis",
        "Speex",
        "WAV",
        "WavPack",
    ];

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

// =========================================================================
// Batch command tests
// =========================================================================

#[test]
fn test_batch_metadata_empty_paths() {
    let result = get_tracks_metadata_batch(vec![]);
    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}

#[test]
fn test_batch_metadata_missing_file_returns_error() {
    let result = get_tracks_metadata_batch(vec!["/nonexistent/file1.mp3".to_string()]);
    assert!(result.is_err());
}

#[test]
fn test_batch_metadata_multiple_missing_files() {
    let result = get_tracks_metadata_batch(vec![
        "/nonexistent/a.mp3".to_string(),
        "/nonexistent/b.flac".to_string(),
        "/nonexistent/c.wav".to_string(),
    ]);
    assert!(result.is_err());
}
