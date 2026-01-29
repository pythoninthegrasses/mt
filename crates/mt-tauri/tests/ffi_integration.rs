// Integration test to verify FFI calls to Zig library work
use std::ffi::CString;
use std::path::PathBuf;

/// Helper to get absolute path to test fixtures directory
fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
}

/// Helper to get absolute path to a test fixture file
fn fixture_path(filename: &str) -> PathBuf {
    fixtures_dir().join(filename)
}

#[test]
fn test_zig_version() {
    unsafe {
        let version = mt_lib::ffi::mt_version();
        let version_str = std::ffi::CStr::from_ptr(version)
            .to_str()
            .expect("Invalid UTF-8 in version string");

        println!("Zig library version: {}", version_str);
        assert!(
            !version_str.is_empty(),
            "Version string should not be empty"
        );
        assert!(
            version_str.contains('.'),
            "Version should contain dots (e.g., 0.1.0)"
        );
    }
}

#[test]
fn test_zig_is_audio_file() {
    unsafe {
        // Test valid audio extensions
        let mp3 = CString::new("song.mp3").unwrap();
        assert!(
            mt_lib::ffi::mt_is_audio_file(mp3.as_ptr()),
            "mp3 should be recognized"
        );

        let flac = CString::new("song.flac").unwrap();
        assert!(
            mt_lib::ffi::mt_is_audio_file(flac.as_ptr()),
            "flac should be recognized"
        );

        let m4a = CString::new("song.m4a").unwrap();
        assert!(
            mt_lib::ffi::mt_is_audio_file(m4a.as_ptr()),
            "m4a should be recognized"
        );

        // Test invalid extensions
        let txt = CString::new("file.txt").unwrap();
        assert!(
            !mt_lib::ffi::mt_is_audio_file(txt.as_ptr()),
            "txt should not be recognized"
        );

        let jpg = CString::new("image.jpg").unwrap();
        assert!(
            !mt_lib::ffi::mt_is_audio_file(jpg.as_ptr()),
            "jpg should not be recognized"
        );
    }
}

#[test]
fn test_zig_fingerprint_matches() {
    use mt_lib::ffi::FileFingerprint;

    unsafe {
        // Create two identical fingerprints
        let fp1 = FileFingerprint {
            mtime_ns: 1234567890000000000,
            size: 1024,
            inode: 0,
            has_mtime: true,
            has_inode: false,
        };

        let fp2 = FileFingerprint {
            mtime_ns: 1234567890000000000,
            size: 1024,
            inode: 0,
            has_mtime: true,
            has_inode: false,
        };

        assert!(
            mt_lib::ffi::mt_fingerprint_matches(&fp1, &fp2),
            "Identical fingerprints should match"
        );

        // Create different fingerprint
        let fp3 = FileFingerprint {
            mtime_ns: 1234567890000000000,
            size: 2048,
            inode: 0,
            has_mtime: true,
            has_inode: false,
        };

        assert!(
            !mt_lib::ffi::mt_fingerprint_matches(&fp1, &fp3),
            "Different fingerprints should not match"
        );
    }
}

#[test]
fn test_extract_metadata_mp3() {
    let path = fixture_path("test_sample.mp3");
    assert!(path.exists(), "Test MP3 file should exist");

    let path_cstr = CString::new(path.to_str().unwrap()).unwrap();

    unsafe {
        let mut metadata = std::mem::zeroed::<mt_lib::ffi::ExtractedMetadata>();
        let success = mt_lib::ffi::mt_extract_metadata_into(path_cstr.as_ptr(), &mut metadata);

        assert!(success, "Metadata extraction should succeed for MP3");
        assert!(metadata.is_valid, "Metadata should be marked as valid");
        assert_eq!(metadata.get_title(), "Test Track", "Title should match");
        assert_eq!(metadata.get_artist(), "Test Artist", "Artist should match");
        assert_eq!(metadata.get_album(), "Test Album", "Album should match");
        assert_eq!(metadata.sample_rate, 44100, "Sample rate should be 44100");
        assert_eq!(metadata.channels, 2, "Channels should be 2 (stereo)");
        assert!(metadata.duration_secs > 0.9 && metadata.duration_secs < 1.1, "Duration should be approximately 1 second");
        assert!(metadata.bitrate > 0, "Bitrate should be present");

        println!("MP3 metadata: title={}, artist={}, album={}, duration={:.2}s, bitrate={}kbps, sample_rate={}Hz, channels={}",
            metadata.get_title(), metadata.get_artist(), metadata.get_album(),
            metadata.duration_secs, metadata.bitrate, metadata.sample_rate, metadata.channels);
    }
}

#[test]
fn test_extract_metadata_flac() {
    let path = fixture_path("test_sample.flac");
    assert!(path.exists(), "Test FLAC file should exist");

    let path_cstr = CString::new(path.to_str().unwrap()).unwrap();

    unsafe {
        let mut metadata = std::mem::zeroed::<mt_lib::ffi::ExtractedMetadata>();
        let success = mt_lib::ffi::mt_extract_metadata_into(path_cstr.as_ptr(), &mut metadata);

        assert!(success, "Metadata extraction should succeed for FLAC");
        assert!(metadata.is_valid, "Metadata should be marked as valid");
        assert_eq!(metadata.get_title(), "FLAC Test", "Title should match");
        assert_eq!(metadata.get_artist(), "FLAC Artist", "Artist should match");
        assert_eq!(metadata.get_album(), "FLAC Album", "Album should match");
        assert_eq!(metadata.sample_rate, 48000, "Sample rate should be 48000");
        assert_eq!(metadata.channels, 2, "Channels should be 2 (stereo)");
        assert!(metadata.duration_secs > 0.9 && metadata.duration_secs < 1.1, "Duration should be approximately 1 second");

        println!("FLAC metadata: title={}, artist={}, album={}, duration={:.2}s, sample_rate={}Hz, channels={}",
            metadata.get_title(), metadata.get_artist(), metadata.get_album(),
            metadata.duration_secs, metadata.sample_rate, metadata.channels);
    }
}

#[test]
fn test_extract_metadata_wav() {
    let path = fixture_path("test_sample.wav");
    assert!(path.exists(), "Test WAV file should exist");

    let path_cstr = CString::new(path.to_str().unwrap()).unwrap();

    unsafe {
        let mut metadata = std::mem::zeroed::<mt_lib::ffi::ExtractedMetadata>();
        let success = mt_lib::ffi::mt_extract_metadata_into(path_cstr.as_ptr(), &mut metadata);

        assert!(success, "Metadata extraction should succeed for WAV");
        assert!(metadata.is_valid, "Metadata should be marked as valid");
        assert_eq!(metadata.sample_rate, 22050, "Sample rate should be 22050");
        assert_eq!(metadata.channels, 1, "Channels should be 1 (mono)");
        assert!(metadata.duration_secs > 0.9 && metadata.duration_secs < 1.1, "Duration should be approximately 1 second");

        println!("WAV metadata: duration={:.2}s, sample_rate={}Hz, channels={}",
            metadata.duration_secs, metadata.sample_rate, metadata.channels);
    }
}

#[test]
fn test_extract_metadata_m4a() {
    let path = fixture_path("test_sample.m4a");
    assert!(path.exists(), "Test M4A file should exist");

    let path_cstr = CString::new(path.to_str().unwrap()).unwrap();

    unsafe {
        let mut metadata = std::mem::zeroed::<mt_lib::ffi::ExtractedMetadata>();
        let success = mt_lib::ffi::mt_extract_metadata_into(path_cstr.as_ptr(), &mut metadata);

        assert!(success, "Metadata extraction should succeed for M4A");
        assert!(metadata.is_valid, "Metadata should be marked as valid");
        assert_eq!(metadata.get_title(), "M4A Test", "Title should match");
        assert_eq!(metadata.get_artist(), "M4A Artist", "Artist should match");
        assert_eq!(metadata.channels, 2, "Channels should be 2 (stereo)");
        assert!(metadata.duration_secs > 0.9 && metadata.duration_secs < 1.1, "Duration should be approximately 1 second");

        println!("M4A metadata: title={}, artist={}, duration={:.2}s, channels={}",
            metadata.get_title(), metadata.get_artist(),
            metadata.duration_secs, metadata.channels);
    }
}

#[test]
fn test_extract_metadata_ogg() {
    let path = fixture_path("test_sample.ogg");
    assert!(path.exists(), "Test OGG file should exist");

    let path_cstr = CString::new(path.to_str().unwrap()).unwrap();

    unsafe {
        let mut metadata = std::mem::zeroed::<mt_lib::ffi::ExtractedMetadata>();
        let success = mt_lib::ffi::mt_extract_metadata_into(path_cstr.as_ptr(), &mut metadata);

        assert!(success, "Metadata extraction should succeed for OGG");
        assert!(metadata.is_valid, "Metadata should be marked as valid");
        assert_eq!(metadata.get_title(), "OGG Test", "Title should match");
        assert_eq!(metadata.get_artist(), "OGG Artist", "Artist should match");
        assert_eq!(metadata.channels, 2, "Channels should be 2 (stereo)");
        assert!(metadata.duration_secs > 0.9 && metadata.duration_secs < 1.1, "Duration should be approximately 1 second");

        println!("OGG metadata: title={}, artist={}, duration={:.2}s, channels={}",
            metadata.get_title(), metadata.get_artist(),
            metadata.duration_secs, metadata.channels);
    }
}

#[test]
fn test_fingerprint_real_files() {
    let mp3_path = fixture_path("test_sample.mp3");
    let flac_path = fixture_path("test_sample.flac");

    assert!(mp3_path.exists(), "Test MP3 file should exist");
    assert!(flac_path.exists(), "Test FLAC file should exist");

    let mp3_cstr = CString::new(mp3_path.to_str().unwrap()).unwrap();
    let flac_cstr = CString::new(flac_path.to_str().unwrap()).unwrap();

    unsafe {
        let mut mp3_fp = std::mem::zeroed::<mt_lib::ffi::FileFingerprint>();
        let mut flac_fp = std::mem::zeroed::<mt_lib::ffi::FileFingerprint>();

        let mp3_success = mt_lib::ffi::mt_get_fingerprint(mp3_cstr.as_ptr(), &mut mp3_fp);
        let flac_success = mt_lib::ffi::mt_get_fingerprint(flac_cstr.as_ptr(), &mut flac_fp);

        assert!(mp3_success, "Should get fingerprint for MP3");
        assert!(flac_success, "Should get fingerprint for FLAC");

        assert!(mp3_fp.has_mtime, "MP3 should have mtime");
        assert!(mp3_fp.size > 0, "MP3 should have positive size");
        assert!(flac_fp.has_mtime, "FLAC should have mtime");
        assert!(flac_fp.size > 0, "FLAC should have positive size");

        // Files should be different
        assert!(
            !mt_lib::ffi::mt_fingerprint_matches(&mp3_fp, &flac_fp),
            "Different files should have different fingerprints"
        );

        // Same file should match itself
        let mut mp3_fp2 = std::mem::zeroed::<mt_lib::ffi::FileFingerprint>();
        let mp3_success2 = mt_lib::ffi::mt_get_fingerprint(mp3_cstr.as_ptr(), &mut mp3_fp2);
        assert!(mp3_success2, "Should get fingerprint for MP3 again");
        assert!(
            mt_lib::ffi::mt_fingerprint_matches(&mp3_fp, &mp3_fp2),
            "Same file should match itself"
        );

        println!("MP3 fingerprint: size={}, mtime={}", mp3_fp.size, mp3_fp.mtime_ns);
        println!("FLAC fingerprint: size={}, mtime={}", flac_fp.size, flac_fp.mtime_ns);
    }
}

#[test]
fn test_batch_metadata_extraction() {
    let mp3_path = fixture_path("test_sample.mp3");
    let flac_path = fixture_path("test_sample.flac");
    let wav_path = fixture_path("test_sample.wav");

    assert!(mp3_path.exists(), "Test MP3 file should exist");
    assert!(flac_path.exists(), "Test FLAC file should exist");
    assert!(wav_path.exists(), "Test WAV file should exist");

    let mp3_cstr = CString::new(mp3_path.to_str().unwrap()).unwrap();
    let flac_cstr = CString::new(flac_path.to_str().unwrap()).unwrap();
    let wav_cstr = CString::new(wav_path.to_str().unwrap()).unwrap();

    unsafe {
        let paths = vec![mp3_cstr.as_ptr(), flac_cstr.as_ptr(), wav_cstr.as_ptr()];
        let mut results: Vec<mt_lib::ffi::ExtractedMetadata> = vec![std::mem::zeroed(); 3];

        let processed = mt_lib::ffi::mt_extract_metadata_batch(
            paths.as_ptr(),
            paths.len(),
            results.as_mut_ptr(),
        );

        assert_eq!(processed, 3, "Should process all 3 files");

        // Verify MP3
        assert!(results[0].is_valid, "MP3 metadata should be valid");
        assert_eq!(results[0].get_title(), "Test Track");

        // Verify FLAC
        assert!(results[1].is_valid, "FLAC metadata should be valid");
        assert_eq!(results[1].get_title(), "FLAC Test");

        // Verify WAV
        assert!(results[2].is_valid, "WAV metadata should be valid");

        println!("Batch extraction processed {} files successfully", processed);
        for (i, result) in results.iter().enumerate() {
            println!("  File {}: title={}, valid={}", i, result.get_title(), result.is_valid);
        }
    }
}

// ============================================================================
// Artwork Cache FFI Tests
// ============================================================================

#[test]
fn test_artwork_cache_create_free() {
    unsafe {
        // Create with default capacity
        let cache = mt_lib::ffi::mt_artwork_cache_new();
        assert!(!cache.is_null(), "Cache creation should succeed");
        assert_eq!(mt_lib::ffi::mt_artwork_cache_len(cache), 0, "New cache should be empty");

        // Free the cache
        mt_lib::ffi::mt_artwork_cache_free(cache);
        println!("Artwork cache create/free test passed");
    }
}

#[test]
fn test_artwork_cache_create_with_capacity() {
    unsafe {
        // Create with custom capacity
        let cache = mt_lib::ffi::mt_artwork_cache_new_with_capacity(50);
        assert!(!cache.is_null(), "Cache creation with capacity should succeed");
        assert_eq!(mt_lib::ffi::mt_artwork_cache_len(cache), 0, "New cache should be empty");

        // Free the cache
        mt_lib::ffi::mt_artwork_cache_free(cache);
        println!("Artwork cache create with capacity test passed");
    }
}

#[test]
fn test_artwork_cache_get_or_load_nonexistent() {
    unsafe {
        let cache = mt_lib::ffi::mt_artwork_cache_new();
        assert!(!cache.is_null(), "Cache creation should succeed");

        let path = CString::new("/nonexistent/path/song.mp3").unwrap();
        let mut artwork: mt_lib::ffi::FfiArtwork = std::mem::zeroed();

        let found = mt_lib::ffi::mt_artwork_cache_get_or_load(
            cache,
            1, // track_id
            path.as_ptr(),
            &mut artwork,
        );

        // Should not find artwork for nonexistent file
        assert!(!found, "Should not find artwork for nonexistent file");

        // But cache should still have an entry (caching the miss)
        assert_eq!(mt_lib::ffi::mt_artwork_cache_len(cache), 1, "Cache should have one entry");

        mt_lib::ffi::mt_artwork_cache_free(cache);
        println!("Artwork cache get_or_load nonexistent test passed");
    }
}

#[test]
fn test_artwork_cache_get_or_load_with_folder_art() {
    use std::fs::File;
    use std::io::Write;

    // Create a temp directory with a cover.jpg
    let dir = tempfile::tempdir().unwrap();
    let cover_path = dir.path().join("cover.jpg");
    let audio_path = dir.path().join("song.mp3");

    // Write a minimal JPEG header to cover.jpg
    let mut file = File::create(&cover_path).unwrap();
    file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]).unwrap();
    file.flush().unwrap();

    // Create an empty "audio" file
    File::create(&audio_path).unwrap();

    unsafe {
        let cache = mt_lib::ffi::mt_artwork_cache_new();
        assert!(!cache.is_null(), "Cache creation should succeed");

        let path_cstr = CString::new(audio_path.to_str().unwrap()).unwrap();
        let mut artwork: mt_lib::ffi::FfiArtwork = std::mem::zeroed();

        let found = mt_lib::ffi::mt_artwork_cache_get_or_load(
            cache,
            1, // track_id
            path_cstr.as_ptr(),
            &mut artwork,
        );

        // Should find the folder artwork
        assert!(found, "Should find folder artwork (cover.jpg)");
        assert_eq!(artwork.get_mime_type(), "image/jpeg", "MIME type should be image/jpeg");
        assert_eq!(artwork.get_source(), "folder", "Source should be 'folder'");
        assert!(artwork.data_len > 0, "Artwork data should not be empty");

        // Cache should have one entry
        assert_eq!(mt_lib::ffi::mt_artwork_cache_len(cache), 1, "Cache should have one entry");

        // Second call should use cache (we can't easily verify but the call should succeed)
        let mut artwork2: mt_lib::ffi::FfiArtwork = std::mem::zeroed();
        let found2 = mt_lib::ffi::mt_artwork_cache_get_or_load(
            cache,
            1, // same track_id
            path_cstr.as_ptr(),
            &mut artwork2,
        );
        assert!(found2, "Second call should also find artwork (from cache)");
        assert_eq!(mt_lib::ffi::mt_artwork_cache_len(cache), 1, "Cache should still have one entry");

        mt_lib::ffi::mt_artwork_cache_free(cache);
        println!("Artwork cache get_or_load with folder art test passed");
    }
}

#[test]
fn test_artwork_cache_invalidate() {
    unsafe {
        let cache = mt_lib::ffi::mt_artwork_cache_new();
        assert!(!cache.is_null(), "Cache creation should succeed");

        // Add an entry
        let path = CString::new("/path/song.mp3").unwrap();
        let mut artwork: mt_lib::ffi::FfiArtwork = std::mem::zeroed();
        let _ = mt_lib::ffi::mt_artwork_cache_get_or_load(cache, 1, path.as_ptr(), &mut artwork);
        assert_eq!(mt_lib::ffi::mt_artwork_cache_len(cache), 1, "Cache should have one entry");

        // Invalidate the entry
        mt_lib::ffi::mt_artwork_cache_invalidate(cache, 1);
        assert_eq!(mt_lib::ffi::mt_artwork_cache_len(cache), 0, "Cache should be empty after invalidate");

        mt_lib::ffi::mt_artwork_cache_free(cache);
        println!("Artwork cache invalidate test passed");
    }
}

#[test]
fn test_artwork_cache_clear() {
    unsafe {
        let cache = mt_lib::ffi::mt_artwork_cache_new();
        assert!(!cache.is_null(), "Cache creation should succeed");

        // Add multiple entries
        for i in 0..5 {
            let path = CString::new(format!("/path/song{}.mp3", i)).unwrap();
            let mut artwork: mt_lib::ffi::FfiArtwork = std::mem::zeroed();
            let _ = mt_lib::ffi::mt_artwork_cache_get_or_load(cache, i, path.as_ptr(), &mut artwork);
        }
        assert_eq!(mt_lib::ffi::mt_artwork_cache_len(cache), 5, "Cache should have 5 entries");

        // Clear all entries
        mt_lib::ffi::mt_artwork_cache_clear(cache);
        assert_eq!(mt_lib::ffi::mt_artwork_cache_len(cache), 0, "Cache should be empty after clear");

        mt_lib::ffi::mt_artwork_cache_free(cache);
        println!("Artwork cache clear test passed");
    }
}

#[test]
fn test_artwork_cache_lru_eviction() {
    unsafe {
        // Create cache with capacity 3
        let cache = mt_lib::ffi::mt_artwork_cache_new_with_capacity(3);
        assert!(!cache.is_null(), "Cache creation should succeed");

        // Add 4 entries (should evict the oldest)
        for i in 0..4 {
            let path = CString::new(format!("/path/song{}.mp3", i)).unwrap();
            let mut artwork: mt_lib::ffi::FfiArtwork = std::mem::zeroed();
            let _ = mt_lib::ffi::mt_artwork_cache_get_or_load(cache, i, path.as_ptr(), &mut artwork);
        }

        // Should only have 3 entries due to LRU eviction
        assert_eq!(mt_lib::ffi::mt_artwork_cache_len(cache), 3, "Cache should have 3 entries (LRU eviction)");

        mt_lib::ffi::mt_artwork_cache_free(cache);
        println!("Artwork cache LRU eviction test passed");
    }
}
