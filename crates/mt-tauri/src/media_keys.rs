use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Default)]
pub struct NowPlayingInfo {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: Option<Duration>,
    pub cover_url: Option<String>,
}

pub struct MediaKeyManager {
    controls: Arc<Mutex<MediaControls>>,
}

impl MediaKeyManager {
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let config = PlatformConfig {
            dbus_name: "mt_music_player",
            display_name: "mt",
            hwnd: None,
        };

        let mut controls = MediaControls::new(config)
            .map_err(|e| format!("Failed to create media controls: {:?}", e))?;

        let app_handle = app.clone();
        controls
            .attach(move |event: MediaControlEvent| {
                println!("Media key event received: {:?}", event);
                let event_name = match event {
                    MediaControlEvent::Play => Some("mediakey://play"),
                    MediaControlEvent::Pause => Some("mediakey://pause"),
                    MediaControlEvent::Toggle => Some("mediakey://toggle"),
                    MediaControlEvent::Next => Some("mediakey://next"),
                    MediaControlEvent::Previous => Some("mediakey://previous"),
                    MediaControlEvent::Stop => Some("mediakey://stop"),
                    _ => None,
                };

                if let Some(name) = event_name {
                    println!("Emitting event: {}", name);
                    let _ = app_handle.emit(name, ());
                }
            })
            .map_err(|e| format!("Failed to attach event handler: {:?}", e))?;

        controls
            .set_metadata(MediaMetadata {
                title: Some("mt"),
                artist: None,
                album: None,
                duration: None,
                cover_url: None,
            })
            .map_err(|e| format!("Failed to set initial metadata: {:?}", e))?;

        controls
            .set_playback(MediaPlayback::Stopped)
            .map_err(|e| format!("Failed to set initial playback state: {:?}", e))?;

        Ok(Self {
            controls: Arc::new(Mutex::new(controls)),
        })
    }

    pub fn set_metadata(&self, info: NowPlayingInfo) -> Result<(), String> {
        let mut controls = self.controls.lock().map_err(|e| e.to_string())?;
        controls
            .set_metadata(MediaMetadata {
                title: info.title.as_deref(),
                artist: info.artist.as_deref(),
                album: info.album.as_deref(),
                duration: info.duration,
                cover_url: info.cover_url.as_deref(),
            })
            .map_err(|e| format!("Failed to set metadata: {:?}", e))
    }

    pub fn set_playing(&self, progress: Option<Duration>) -> Result<(), String> {
        let mut controls = self.controls.lock().map_err(|e| e.to_string())?;
        controls
            .set_playback(MediaPlayback::Playing {
                progress: progress.map(MediaPosition),
            })
            .map_err(|e| format!("Failed to set playing state: {:?}", e))
    }

    pub fn set_paused(&self, progress: Option<Duration>) -> Result<(), String> {
        let mut controls = self.controls.lock().map_err(|e| e.to_string())?;
        controls
            .set_playback(MediaPlayback::Paused {
                progress: progress.map(MediaPosition),
            })
            .map_err(|e| format!("Failed to set paused state: {:?}", e))
    }

    pub fn set_stopped(&self) -> Result<(), String> {
        let mut controls = self.controls.lock().map_err(|e| e.to_string())?;
        controls
            .set_playback(MediaPlayback::Stopped)
            .map_err(|e| format!("Failed to set stopped state: {:?}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // NowPlayingInfo struct tests
    // =========================================================================

    #[test]
    fn test_now_playing_info_default() {
        let info = NowPlayingInfo::default();

        assert!(info.title.is_none());
        assert!(info.artist.is_none());
        assert!(info.album.is_none());
        assert!(info.duration.is_none());
        assert!(info.cover_url.is_none());
    }

    #[test]
    fn test_now_playing_info_with_all_fields() {
        let info = NowPlayingInfo {
            title: Some("Test Song".to_string()),
            artist: Some("Test Artist".to_string()),
            album: Some("Test Album".to_string()),
            duration: Some(Duration::from_secs(180)),
            cover_url: Some("https://example.com/cover.jpg".to_string()),
        };

        assert_eq!(info.title, Some("Test Song".to_string()));
        assert_eq!(info.artist, Some("Test Artist".to_string()));
        assert_eq!(info.album, Some("Test Album".to_string()));
        assert_eq!(info.duration, Some(Duration::from_secs(180)));
        assert_eq!(
            info.cover_url,
            Some("https://example.com/cover.jpg".to_string())
        );
    }

    #[test]
    fn test_now_playing_info_partial_fields() {
        let info = NowPlayingInfo {
            title: Some("Title Only".to_string()),
            artist: None,
            album: None,
            duration: None,
            cover_url: None,
        };

        assert!(info.title.is_some());
        assert!(info.artist.is_none());
    }

    #[test]
    fn test_now_playing_info_clone() {
        let info = NowPlayingInfo {
            title: Some("Clone Test".to_string()),
            artist: Some("Clone Artist".to_string()),
            album: None,
            duration: Some(Duration::from_secs(60)),
            cover_url: None,
        };

        let cloned = info.clone();
        assert_eq!(info.title, cloned.title);
        assert_eq!(info.artist, cloned.artist);
        assert_eq!(info.album, cloned.album);
        assert_eq!(info.duration, cloned.duration);
        assert_eq!(info.cover_url, cloned.cover_url);
    }

    #[test]
    fn test_now_playing_info_debug() {
        let info = NowPlayingInfo {
            title: Some("Debug Test".to_string()),
            artist: None,
            album: None,
            duration: None,
            cover_url: None,
        };

        let debug_str = format!("{:?}", info);
        assert!(debug_str.contains("NowPlayingInfo"));
        assert!(debug_str.contains("Debug Test"));
    }

    #[test]
    fn test_now_playing_info_duration_zero() {
        let info = NowPlayingInfo {
            title: Some("Short Track".to_string()),
            artist: None,
            album: None,
            duration: Some(Duration::from_secs(0)),
            cover_url: None,
        };

        assert_eq!(info.duration, Some(Duration::from_secs(0)));
    }

    #[test]
    fn test_now_playing_info_long_duration() {
        // Test with a very long track (e.g., an audiobook or long podcast)
        let info = NowPlayingInfo {
            title: Some("Audiobook Chapter".to_string()),
            artist: None,
            album: None,
            duration: Some(Duration::from_secs(3600 * 5)), // 5 hours
            cover_url: None,
        };

        assert_eq!(info.duration, Some(Duration::from_secs(18000)));
    }

    #[test]
    fn test_now_playing_info_unicode_title() {
        let info = NowPlayingInfo {
            title: Some("日本語のタイトル".to_string()),
            artist: Some("アーティスト名".to_string()),
            album: Some("アルバム名".to_string()),
            duration: None,
            cover_url: None,
        };

        assert_eq!(info.title, Some("日本語のタイトル".to_string()));
        assert_eq!(info.artist, Some("アーティスト名".to_string()));
    }

    #[test]
    fn test_now_playing_info_special_chars() {
        let info = NowPlayingInfo {
            title: Some("Track \"Special\" & <Cool>".to_string()),
            artist: Some("Artist & Friends".to_string()),
            album: None,
            duration: None,
            cover_url: None,
        };

        assert!(info.title.as_ref().unwrap().contains("&"));
        assert!(info.title.as_ref().unwrap().contains("\""));
    }

    #[test]
    fn test_now_playing_info_empty_strings() {
        let info = NowPlayingInfo {
            title: Some("".to_string()),
            artist: Some("".to_string()),
            album: Some("".to_string()),
            duration: None,
            cover_url: Some("".to_string()),
        };

        assert_eq!(info.title, Some("".to_string()));
        assert!(info.title.as_ref().unwrap().is_empty());
    }

    // =========================================================================
    // Duration conversion tests
    // =========================================================================

    #[test]
    fn test_duration_from_millis() {
        let duration_ms: u64 = 180000; // 3 minutes
        let duration = Duration::from_millis(duration_ms);

        assert_eq!(duration.as_secs(), 180);
        assert_eq!(duration.as_millis(), 180000);
    }

    #[test]
    fn test_duration_subsecond() {
        let duration = Duration::from_millis(3500); // 3.5 seconds
        assert_eq!(duration.as_secs(), 3);
        assert_eq!(duration.subsec_millis(), 500);
    }
}
