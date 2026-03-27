//! Unit tests for audio engine types and serialization.
//!
//! These tests verify the correctness of audio-related types
//! without requiring actual audio output.

#[cfg(test)]
mod tests {
    use crate::audio::{PlaybackState, Progress, TrackInfo};

    // ==================== PlaybackState Tests ====================

    #[test]
    fn test_playback_state_variants() {
        assert_eq!(PlaybackState::Stopped, PlaybackState::Stopped);
        assert_eq!(PlaybackState::Playing, PlaybackState::Playing);
        assert_eq!(PlaybackState::Paused, PlaybackState::Paused);

        assert_ne!(PlaybackState::Stopped, PlaybackState::Playing);
        assert_ne!(PlaybackState::Playing, PlaybackState::Paused);
    }

    #[test]
    fn test_playback_state_clone() {
        let state = PlaybackState::Playing;
        let cloned = state.clone();
        assert_eq!(state, cloned);
    }

    #[test]
    fn test_playback_state_copy() {
        let state = PlaybackState::Paused;
        let copied = state; // Copy trait
        assert_eq!(state, copied);
    }

    #[test]
    fn test_playback_state_serialization() {
        let stopped = serde_json::to_string(&PlaybackState::Stopped).unwrap();
        let playing = serde_json::to_string(&PlaybackState::Playing).unwrap();
        let paused = serde_json::to_string(&PlaybackState::Paused).unwrap();

        assert_eq!(stopped, "\"Stopped\"");
        assert_eq!(playing, "\"Playing\"");
        assert_eq!(paused, "\"Paused\"");
    }

    #[test]
    fn test_playback_state_deserialization() {
        let stopped: PlaybackState = serde_json::from_str("\"Stopped\"").unwrap();
        let playing: PlaybackState = serde_json::from_str("\"Playing\"").unwrap();
        let paused: PlaybackState = serde_json::from_str("\"Paused\"").unwrap();

        assert_eq!(stopped, PlaybackState::Stopped);
        assert_eq!(playing, PlaybackState::Playing);
        assert_eq!(paused, PlaybackState::Paused);
    }

    #[test]
    fn test_playback_state_debug() {
        let state = PlaybackState::Playing;
        let debug = format!("{:?}", state);
        assert_eq!(debug, "Playing");
    }

    // ==================== TrackInfo Tests ====================

    #[test]
    fn test_track_info_creation() {
        let info = TrackInfo {
            path: "/music/song.mp3".to_string(),
            duration_ms: 180000,
            sample_rate: 44100,
            channels: 2,
        };

        assert_eq!(info.path, "/music/song.mp3");
        assert_eq!(info.duration_ms, 180000);
        assert_eq!(info.sample_rate, 44100);
        assert_eq!(info.channels, 2);
    }

    #[test]
    fn test_track_info_clone() {
        let info = TrackInfo {
            path: "/music/track.flac".to_string(),
            duration_ms: 300000,
            sample_rate: 96000,
            channels: 2,
        };

        let cloned = info.clone();
        assert_eq!(info.path, cloned.path);
        assert_eq!(info.duration_ms, cloned.duration_ms);
        assert_eq!(info.sample_rate, cloned.sample_rate);
        assert_eq!(info.channels, cloned.channels);
    }

    #[test]
    fn test_track_info_serialization() {
        let info = TrackInfo {
            path: "/music/song.mp3".to_string(),
            duration_ms: 180000,
            sample_rate: 44100,
            channels: 2,
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"path\":\"/music/song.mp3\""));
        assert!(json.contains("\"duration_ms\":180000"));
        assert!(json.contains("\"sample_rate\":44100"));
        assert!(json.contains("\"channels\":2"));
    }

    #[test]
    fn test_track_info_deserialization() {
        let json = r#"{
            "path": "/test/audio.wav",
            "duration_ms": 60000,
            "sample_rate": 48000,
            "channels": 1
        }"#;

        let info: TrackInfo = serde_json::from_str(json).unwrap();
        assert_eq!(info.path, "/test/audio.wav");
        assert_eq!(info.duration_ms, 60000);
        assert_eq!(info.sample_rate, 48000);
        assert_eq!(info.channels, 1);
    }

    #[test]
    fn test_track_info_mono_stereo() {
        let mono = TrackInfo {
            path: "/mono.mp3".to_string(),
            duration_ms: 1000,
            sample_rate: 44100,
            channels: 1,
        };

        let stereo = TrackInfo {
            path: "/stereo.mp3".to_string(),
            duration_ms: 1000,
            sample_rate: 44100,
            channels: 2,
        };

        assert_eq!(mono.channels, 1);
        assert_eq!(stereo.channels, 2);
    }

    #[test]
    fn test_track_info_various_sample_rates() {
        let rates = [8000u32, 11025, 22050, 44100, 48000, 88200, 96000, 192000];

        for rate in rates {
            let info = TrackInfo {
                path: "/test.mp3".to_string(),
                duration_ms: 1000,
                sample_rate: rate,
                channels: 2,
            };
            assert_eq!(info.sample_rate, rate);
        }
    }

    #[test]
    fn test_track_info_zero_duration() {
        let info = TrackInfo {
            path: "/empty.mp3".to_string(),
            duration_ms: 0,
            sample_rate: 44100,
            channels: 2,
        };
        assert_eq!(info.duration_ms, 0);
    }

    #[test]
    fn test_track_info_long_duration() {
        // Test very long track (e.g., 10 hours in ms)
        let ten_hours_ms = 10 * 60 * 60 * 1000;
        let info = TrackInfo {
            path: "/long.mp3".to_string(),
            duration_ms: ten_hours_ms,
            sample_rate: 44100,
            channels: 2,
        };
        assert_eq!(info.duration_ms, ten_hours_ms);
    }

    // ==================== Progress Tests ====================

    #[test]
    fn test_progress_creation() {
        let progress = Progress {
            position_ms: 30000,
            duration_ms: 180000,
            state: PlaybackState::Playing,
        };

        assert_eq!(progress.position_ms, 30000);
        assert_eq!(progress.duration_ms, 180000);
        assert_eq!(progress.state, PlaybackState::Playing);
    }

    #[test]
    fn test_progress_clone() {
        let progress = Progress {
            position_ms: 60000,
            duration_ms: 300000,
            state: PlaybackState::Paused,
        };

        let cloned = progress.clone();
        assert_eq!(progress.position_ms, cloned.position_ms);
        assert_eq!(progress.duration_ms, cloned.duration_ms);
        assert_eq!(progress.state, cloned.state);
    }

    #[test]
    fn test_progress_serialization() {
        let progress = Progress {
            position_ms: 45000,
            duration_ms: 200000,
            state: PlaybackState::Playing,
        };

        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("\"position_ms\":45000"));
        assert!(json.contains("\"duration_ms\":200000"));
        assert!(json.contains("\"state\":\"Playing\""));
    }

    #[test]
    fn test_progress_deserialization() {
        let json = r#"{
            "position_ms": 90000,
            "duration_ms": 240000,
            "state": "Paused"
        }"#;

        let progress: Progress = serde_json::from_str(json).unwrap();
        assert_eq!(progress.position_ms, 90000);
        assert_eq!(progress.duration_ms, 240000);
        assert_eq!(progress.state, PlaybackState::Paused);
    }

    #[test]
    fn test_progress_at_start() {
        let progress = Progress {
            position_ms: 0,
            duration_ms: 180000,
            state: PlaybackState::Stopped,
        };

        assert_eq!(progress.position_ms, 0);
    }

    #[test]
    fn test_progress_at_end() {
        let progress = Progress {
            position_ms: 180000,
            duration_ms: 180000,
            state: PlaybackState::Stopped,
        };

        assert_eq!(progress.position_ms, progress.duration_ms);
    }

    #[test]
    fn test_progress_percentage_calculation() {
        let progress = Progress {
            position_ms: 90000,  // 1.5 minutes
            duration_ms: 180000, // 3 minutes
            state: PlaybackState::Playing,
        };

        let percentage = if progress.duration_ms > 0 {
            (progress.position_ms as f64 / progress.duration_ms as f64) * 100.0
        } else {
            0.0
        };

        assert!((percentage - 50.0).abs() < 0.01);
    }

    #[test]
    fn test_progress_with_zero_duration() {
        let progress = Progress {
            position_ms: 0,
            duration_ms: 0,
            state: PlaybackState::Stopped,
        };

        // Should handle zero duration gracefully
        let percentage = if progress.duration_ms > 0 {
            (progress.position_ms as f64 / progress.duration_ms as f64) * 100.0
        } else {
            0.0
        };

        assert_eq!(percentage, 0.0);
    }

    #[test]
    fn test_progress_all_states() {
        for state in [
            PlaybackState::Stopped,
            PlaybackState::Playing,
            PlaybackState::Paused,
        ] {
            let progress = Progress {
                position_ms: 1000,
                duration_ms: 2000,
                state,
            };
            assert_eq!(progress.state, state);
        }
    }

    // ==================== Edge Cases ====================

    #[test]
    fn test_track_info_unicode_path() {
        let info = TrackInfo {
            path: "/音楽/日本語の曲.mp3".to_string(),
            duration_ms: 180000,
            sample_rate: 44100,
            channels: 2,
        };

        let json = serde_json::to_string(&info).unwrap();
        let deserialized: TrackInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(info.path, deserialized.path);
    }

    #[test]
    fn test_track_info_special_characters_in_path() {
        let info = TrackInfo {
            path: "/music/Artist - Track (feat. Other) [Remix].mp3".to_string(),
            duration_ms: 180000,
            sample_rate: 44100,
            channels: 2,
        };

        let json = serde_json::to_string(&info).unwrap();
        let deserialized: TrackInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(info.path, deserialized.path);
    }

    #[test]
    fn test_track_info_empty_path() {
        let info = TrackInfo {
            path: "".to_string(),
            duration_ms: 0,
            sample_rate: 44100,
            channels: 2,
        };

        assert!(info.path.is_empty());
    }

    #[test]
    fn test_progress_max_values() {
        let progress = Progress {
            position_ms: u64::MAX,
            duration_ms: u64::MAX,
            state: PlaybackState::Playing,
        };

        let json = serde_json::to_string(&progress).unwrap();
        let deserialized: Progress = serde_json::from_str(&json).unwrap();
        assert_eq!(progress.position_ms, deserialized.position_ms);
        assert_eq!(progress.duration_ms, deserialized.duration_ms);
    }

    // ==================== Device Enumeration Tests ====================

    #[test]
    fn test_list_output_devices_returns_vec() {
        use crate::audio::list_output_devices;

        let result = list_output_devices();
        // Should succeed on any machine with audio hardware (CI may not have devices)
        match result {
            Ok(devices) => {
                // Each device name should be non-empty
                for name in &devices {
                    assert!(!name.is_empty(), "Device name should not be empty");
                }
            }
            Err(e) => {
                // Acceptable on headless CI: no audio host available
                let msg = e.to_string();
                assert!(
                    msg.contains("Device") || msg.contains("enumerate"),
                    "Unexpected error: {}",
                    msg
                );
            }
        }
    }

    #[test]
    fn test_set_device_nonexistent_returns_error() {
        use crate::audio::AudioEngine;

        let engine = AudioEngine::new();
        match engine {
            Ok(mut engine) => {
                let result = engine.set_device(Some("__nonexistent_device_12345__"));
                assert!(result.is_err(), "set_device with bogus name should fail");
                let err_msg = result.unwrap_err().to_string();
                assert!(
                    err_msg.contains("not found"),
                    "Error should mention 'not found': {}",
                    err_msg
                );
            }
            Err(_) => {
                // No audio output available (headless CI) — skip
            }
        }
    }

    #[test]
    fn test_set_device_none_switches_to_default() {
        use crate::audio::AudioEngine;

        let engine = AudioEngine::new();
        match engine {
            Ok(mut engine) => {
                // Switching to default (None) should succeed
                let result = engine.set_device(None);
                assert!(
                    result.is_ok(),
                    "set_device(None) should succeed: {:?}",
                    result.err()
                );
            }
            Err(_) => {
                // No audio output available (headless CI) — skip
            }
        }
    }

    // ==================== No-Stream Error Handling ====================

    #[test]
    fn test_load_returns_error_when_stream_is_none() {
        use crate::audio::AudioEngine;
        use std::path::PathBuf;

        let engine = AudioEngine::new();
        match engine {
            Ok(mut engine) => {
                engine.drop_stream();
                let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/fixtures/test_sample.mp3");
                let result = engine.load(fixture.to_str().unwrap());
                assert!(
                    result.is_err(),
                    "load() should fail without an active stream"
                );
                let err = result.unwrap_err().to_string();
                assert!(
                    err.contains("No active audio stream"),
                    "Expected stream error, got: {}",
                    err
                );
            }
            Err(_) => {}
        }
    }

    #[test]
    fn test_seek_backward_returns_error_when_stream_is_none() {
        use crate::audio::AudioEngine;
        use std::path::PathBuf;

        let engine = AudioEngine::new();
        match engine {
            Ok(mut engine) => {
                let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/fixtures/test_sample.mp3");

                // Load a track so there's something to seek on
                let load_result = engine.load(fixture.to_str().unwrap());
                if load_result.is_err() {
                    return; // Audio hardware not usable
                }
                engine.play().unwrap();

                // Seek forward to give us a position to seek backward from
                let _ = engine.seek(2000);

                // Drop the stream to simulate the transient None state
                engine.drop_stream();

                // Backward seek (reload path) should return a stream error
                let result = engine.seek(0);
                assert!(result.is_err(), "seek should fail without an active stream");
                let err = result.unwrap_err().to_string();
                assert!(
                    err.contains("No active audio stream"),
                    "Expected stream error, got: {}",
                    err
                );
            }
            Err(_) => {}
        }
    }

    // ==================== Device Switch State Preservation ====================

    #[test]
    fn test_set_device_preserves_stopped_state_without_track() {
        use crate::audio::AudioEngine;

        let engine = AudioEngine::new();
        match engine {
            Ok(mut engine) => {
                assert_eq!(engine.get_state(), PlaybackState::Stopped);
                assert!(engine.get_current_track().is_none());

                let result = engine.set_device(None);
                assert!(
                    result.is_ok(),
                    "set_device(None) failed: {:?}",
                    result.err()
                );

                // State should remain Stopped, no track loaded
                assert_eq!(engine.get_state(), PlaybackState::Stopped);
                assert!(engine.get_current_track().is_none());
            }
            Err(_) => {}
        }
    }

    #[test]
    fn test_set_device_preserves_paused_state_with_track() {
        use crate::audio::AudioEngine;
        use std::path::PathBuf;

        let engine = AudioEngine::new();
        match engine {
            Ok(mut engine) => {
                let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/fixtures/test_sample.mp3");

                let load_result = engine.load(fixture.to_str().unwrap());
                if load_result.is_err() {
                    return;
                }

                // Engine is paused after load (not yet playing)
                assert_eq!(engine.get_state(), PlaybackState::Paused);
                let track_path = engine.get_current_track().unwrap().path.clone();

                let result = engine.set_device(None);
                assert!(
                    result.is_ok(),
                    "set_device(None) failed: {:?}",
                    result.err()
                );

                // Track should still be loaded and paused
                assert_eq!(engine.get_state(), PlaybackState::Paused);
                assert!(engine.get_current_track().is_some());
                assert_eq!(engine.get_current_track().unwrap().path, track_path);
            }
            Err(_) => {}
        }
    }

    #[test]
    fn test_set_device_preserves_playing_state() {
        use crate::audio::AudioEngine;
        use std::path::PathBuf;

        let engine = AudioEngine::new();
        match engine {
            Ok(mut engine) => {
                let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/fixtures/test_sample.mp3");

                let load_result = engine.load(fixture.to_str().unwrap());
                if load_result.is_err() {
                    return;
                }
                engine.play().unwrap();
                assert_eq!(engine.get_state(), PlaybackState::Playing);

                let result = engine.set_device(None);
                assert!(
                    result.is_ok(),
                    "set_device(None) failed: {:?}",
                    result.err()
                );

                // Should still be playing after device switch
                assert_eq!(engine.get_state(), PlaybackState::Playing);
                assert!(engine.get_current_track().is_some());
            }
            Err(_) => {}
        }
    }

    #[test]
    fn test_set_device_preserves_volume() {
        use crate::audio::AudioEngine;

        let engine = AudioEngine::new();
        match engine {
            Ok(mut engine) => {
                engine.set_volume(0.42);
                assert!((engine.get_volume() - 0.42).abs() < f32::EPSILON);

                let result = engine.set_device(None);
                assert!(
                    result.is_ok(),
                    "set_device(None) failed: {:?}",
                    result.err()
                );

                assert!(
                    (engine.get_volume() - 0.42).abs() < f32::EPSILON,
                    "Volume should be preserved after device switch, got: {}",
                    engine.get_volume()
                );
            }
            Err(_) => {}
        }
    }

    #[test]
    fn test_set_device_nonexistent_preserves_playback() {
        use crate::audio::AudioEngine;
        use std::path::PathBuf;

        let engine = AudioEngine::new();
        match engine {
            Ok(mut engine) => {
                let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/fixtures/test_sample.mp3");

                let load_result = engine.load(fixture.to_str().unwrap());
                if load_result.is_err() {
                    return;
                }
                engine.play().unwrap();

                // Attempting a bogus device should fail but NOT disrupt playback
                let result = engine.set_device(Some("__nonexistent_device_xyz__"));
                assert!(result.is_err());

                // Playback should still be intact
                assert_eq!(engine.get_state(), PlaybackState::Playing);
                assert!(engine.get_current_track().is_some());
            }
            Err(_) => {}
        }
    }

    #[test]
    fn test_set_device_consecutive_switches() {
        use crate::audio::AudioEngine;
        use std::path::PathBuf;

        let engine = AudioEngine::new();
        match engine {
            Ok(mut engine) => {
                let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/fixtures/test_sample.mp3");

                let load_result = engine.load(fixture.to_str().unwrap());
                if load_result.is_err() {
                    return;
                }
                engine.play().unwrap();

                // Switch to default multiple times in succession
                for i in 0..3 {
                    let result = engine.set_device(None);
                    assert!(
                        result.is_ok(),
                        "set_device(None) failed on iteration {}: {:?}",
                        i,
                        result.err()
                    );
                    assert_eq!(
                        engine.get_state(),
                        PlaybackState::Playing,
                        "Should still be playing after switch #{}",
                        i
                    );
                }

                assert!(engine.get_current_track().is_some());
            }
            Err(_) => {}
        }
    }

    #[test]
    fn test_set_device_load_works_after_switch() {
        use crate::audio::AudioEngine;
        use std::path::PathBuf;

        let engine = AudioEngine::new();
        match engine {
            Ok(mut engine) => {
                let result = engine.set_device(None);
                assert!(
                    result.is_ok(),
                    "set_device(None) failed: {:?}",
                    result.err()
                );

                // Loading a track after device switch should work
                let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/fixtures/test_sample.mp3");
                let load_result = engine.load(fixture.to_str().unwrap());
                assert!(
                    load_result.is_ok(),
                    "load() after device switch failed: {:?}",
                    load_result.err()
                );
                assert!(engine.get_current_track().is_some());
            }
            Err(_) => {}
        }
    }
}
