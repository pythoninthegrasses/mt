//! Tauri event types for real-time UI updates.
//!
//! This module defines all event types that can be emitted from the Rust backend
//! to the frontend. These replace the WebSocket events from the Python backend.
//!
//! Event naming convention: `domain:action` (e.g., `library:updated`)

use serde::Serialize;

// ============================================
// Library Events
// ============================================

/// Emitted when library tracks are added, modified, or deleted
#[derive(Clone, Debug, Serialize)]
pub struct LibraryUpdatedEvent {
    /// The type of change: "added", "modified", "deleted"
    pub action: String,
    /// The IDs of affected tracks
    pub track_ids: Vec<i64>,
}

impl LibraryUpdatedEvent {
    pub const EVENT_NAME: &'static str = "library:updated";

    pub fn added(track_ids: Vec<i64>) -> Self {
        Self {
            action: "added".to_string(),
            track_ids,
        }
    }

    pub fn modified(track_ids: Vec<i64>) -> Self {
        Self {
            action: "modified".to_string(),
            track_ids,
        }
    }

    pub fn deleted(track_ids: Vec<i64>) -> Self {
        Self {
            action: "deleted".to_string(),
            track_ids,
        }
    }
}

/// Emitted during library scan to report progress
#[derive(Clone, Debug, Serialize)]
pub struct ScanProgressEvent {
    /// Unique identifier for this scan job
    pub job_id: String,
    /// Current status: "scanning", "processing", "complete", "error"
    pub status: String,
    /// Number of files scanned so far
    pub scanned: u32,
    /// Number of new tracks found
    pub found: u32,
    /// Number of errors encountered
    pub errors: u32,
    /// Current file/directory being processed
    pub current_path: Option<String>,
}

impl ScanProgressEvent {
    pub const EVENT_NAME: &'static str = "library:scan-progress";
}

/// Emitted when a library scan completes
#[derive(Clone, Debug, Serialize)]
pub struct ScanCompleteEvent {
    /// Unique identifier for the completed scan job
    pub job_id: String,
    /// Number of tracks added to library
    pub added: u32,
    /// Number of files skipped (already in library or not audio)
    pub skipped: u32,
    /// Number of errors during scan
    pub errors: u32,
    /// Total scan duration in milliseconds
    pub duration_ms: u64,
}

impl ScanCompleteEvent {
    pub const EVENT_NAME: &'static str = "library:scan-complete";
}

// ============================================
// Queue Events
// ============================================

/// Emitted when the playback queue changes
#[derive(Clone, Debug, Serialize)]
pub struct QueueUpdatedEvent {
    /// The type of change: "added", "removed", "cleared", "reordered", "shuffled"
    pub action: String,
    /// Affected positions in the queue (if applicable)
    pub positions: Option<Vec<i64>>,
    /// Current queue length after the change
    pub queue_length: i64,
}

impl QueueUpdatedEvent {
    pub const EVENT_NAME: &'static str = "queue:updated";

    pub fn added(positions: Vec<i64>, queue_length: i64) -> Self {
        Self {
            action: "added".to_string(),
            positions: Some(positions),
            queue_length,
        }
    }

    pub fn removed(position: i64, queue_length: i64) -> Self {
        Self {
            action: "removed".to_string(),
            positions: Some(vec![position]),
            queue_length,
        }
    }

    pub fn cleared() -> Self {
        Self {
            action: "cleared".to_string(),
            positions: None,
            queue_length: 0,
        }
    }

    pub fn reordered(from: i64, to: i64, queue_length: i64) -> Self {
        Self {
            action: "reordered".to_string(),
            positions: Some(vec![from, to]),
            queue_length,
        }
    }

    pub fn shuffled(queue_length: i64) -> Self {
        Self {
            action: "shuffled".to_string(),
            positions: None,
            queue_length,
        }
    }
}

/// Emitted when queue playback state changes (shuffle, loop, current index)
#[derive(Clone, Debug, Serialize)]
pub struct QueueStateChangedEvent {
    pub current_index: i64,
    pub shuffle_enabled: bool,
    pub loop_mode: String,
}

impl QueueStateChangedEvent {
    pub const EVENT_NAME: &'static str = "queue:state-changed";

    pub fn new(current_index: i64, shuffle_enabled: bool, loop_mode: String) -> Self {
        Self {
            current_index,
            shuffle_enabled,
            loop_mode,
        }
    }
}

// ============================================
// Favorites Events
// ============================================

/// Emitted when a track is added to or removed from favorites
#[derive(Clone, Debug, Serialize)]
pub struct FavoritesUpdatedEvent {
    /// The type of change: "added", "removed"
    pub action: String,
    /// The track ID that was affected
    pub track_id: i64,
}

impl FavoritesUpdatedEvent {
    pub const EVENT_NAME: &'static str = "favorites:updated";

    pub fn added(track_id: i64) -> Self {
        Self {
            action: "added".to_string(),
            track_id,
        }
    }

    pub fn removed(track_id: i64) -> Self {
        Self {
            action: "removed".to_string(),
            track_id,
        }
    }
}

// ============================================
// Playlist Events
// ============================================

/// Emitted when a playlist is created, modified, or deleted
#[derive(Clone, Debug, Serialize)]
pub struct PlaylistsUpdatedEvent {
    /// The type of change: "created", "renamed", "deleted", "tracks_added", "tracks_removed", "reordered"
    pub action: String,
    /// The playlist ID that was affected
    pub playlist_id: i64,
    /// Track IDs involved in the change (for track operations)
    pub track_ids: Option<Vec<i64>>,
}

impl PlaylistsUpdatedEvent {
    pub const EVENT_NAME: &'static str = "playlists:updated";

    pub fn created(playlist_id: i64) -> Self {
        Self {
            action: "created".to_string(),
            playlist_id,
            track_ids: None,
        }
    }

    pub fn renamed(playlist_id: i64) -> Self {
        Self {
            action: "renamed".to_string(),
            playlist_id,
            track_ids: None,
        }
    }

    pub fn deleted(playlist_id: i64) -> Self {
        Self {
            action: "deleted".to_string(),
            playlist_id,
            track_ids: None,
        }
    }

    pub fn tracks_added(playlist_id: i64, track_ids: Vec<i64>) -> Self {
        Self {
            action: "tracks_added".to_string(),
            playlist_id,
            track_ids: Some(track_ids),
        }
    }

    pub fn tracks_removed(playlist_id: i64, track_ids: Vec<i64>) -> Self {
        Self {
            action: "tracks_removed".to_string(),
            playlist_id,
            track_ids: Some(track_ids),
        }
    }

    pub fn reordered(playlist_id: i64) -> Self {
        Self {
            action: "reordered".to_string(),
            playlist_id,
            track_ids: None,
        }
    }
}

// ============================================
// Settings Events
// ============================================

/// Emitted when a setting value changes
#[derive(Clone, Debug, Serialize)]
pub struct SettingsUpdatedEvent {
    /// The setting key that changed
    pub key: String,
    /// The new value (as JSON value)
    pub value: serde_json::Value,
    /// The previous value (as JSON value, if available)
    pub previous_value: Option<serde_json::Value>,
}

impl SettingsUpdatedEvent {
    pub const EVENT_NAME: &'static str = "settings:updated";

    pub fn new(key: String, value: serde_json::Value, previous_value: Option<serde_json::Value>) -> Self {
        Self {
            key,
            value,
            previous_value,
        }
    }
}

// ============================================
// Last.fm Events
// ============================================

/// Emitted when Last.fm authentication state changes
#[derive(Clone, Debug, Serialize)]
pub struct LastfmAuthEvent {
    /// Authentication state: "authenticated", "disconnected", "pending"
    pub state: String,
    /// Username if authenticated
    pub username: Option<String>,
}

impl LastfmAuthEvent {
    pub const EVENT_NAME: &'static str = "lastfm:auth";

    pub fn authenticated(username: String) -> Self {
        Self {
            state: "authenticated".to_string(),
            username: Some(username),
        }
    }

    pub fn disconnected() -> Self {
        Self {
            state: "disconnected".to_string(),
            username: None,
        }
    }

    pub fn pending() -> Self {
        Self {
            state: "pending".to_string(),
            username: None,
        }
    }
}

/// Emitted when scrobble status changes
#[derive(Clone, Debug, Serialize)]
pub struct ScrobbleStatusEvent {
    /// Status: "success", "queued", "failed"
    pub status: String,
    /// Track artist
    pub artist: String,
    /// Track title
    pub track: String,
    /// Optional error message
    pub message: Option<String>,
}

impl ScrobbleStatusEvent {
    pub const EVENT_NAME: &'static str = "lastfm:scrobble-status";

    pub fn success(artist: String, track: String) -> Self {
        Self {
            status: "success".to_string(),
            artist,
            track,
            message: None,
        }
    }

    pub fn queued(artist: String, track: String) -> Self {
        Self {
            status: "queued".to_string(),
            artist,
            track,
            message: Some("Queued for retry".to_string()),
        }
    }

    pub fn failed(artist: String, track: String, message: String) -> Self {
        Self {
            status: "failed".to_string(),
            artist,
            track,
            message: Some(message),
        }
    }
}

/// Emitted when scrobble queue status changes
#[derive(Clone, Debug, Serialize)]
pub struct LastfmQueueUpdatedEvent {
    /// Number of queued scrobbles
    pub queued_count: usize,
}

impl LastfmQueueUpdatedEvent {
    pub const EVENT_NAME: &'static str = "lastfm:queue-updated";

    pub fn new(queued_count: usize) -> Self {
        Self { queued_count }
    }
}

// ============================================
// Helper trait for emitting events
// ============================================

/// Extension trait for emitting typed events
pub trait EventEmitter {
    fn emit_library_updated(&self, event: LibraryUpdatedEvent) -> Result<(), String>;
    fn emit_scan_progress(&self, event: ScanProgressEvent) -> Result<(), String>;
    fn emit_scan_complete(&self, event: ScanCompleteEvent) -> Result<(), String>;
    fn emit_queue_updated(&self, event: QueueUpdatedEvent) -> Result<(), String>;
    fn emit_queue_state_changed(&self, event: QueueStateChangedEvent) -> Result<(), String>;
    fn emit_favorites_updated(&self, event: FavoritesUpdatedEvent) -> Result<(), String>;
    fn emit_playlists_updated(&self, event: PlaylistsUpdatedEvent) -> Result<(), String>;
    fn emit_settings_updated(&self, event: SettingsUpdatedEvent) -> Result<(), String>;
}

impl EventEmitter for tauri::AppHandle {
    fn emit_library_updated(&self, event: LibraryUpdatedEvent) -> Result<(), String> {
        use tauri::Emitter;
        self.emit(LibraryUpdatedEvent::EVENT_NAME, event)
            .map_err(|e| e.to_string())
    }

    fn emit_scan_progress(&self, event: ScanProgressEvent) -> Result<(), String> {
        use tauri::Emitter;
        self.emit(ScanProgressEvent::EVENT_NAME, event)
            .map_err(|e| e.to_string())
    }

    fn emit_scan_complete(&self, event: ScanCompleteEvent) -> Result<(), String> {
        use tauri::Emitter;
        self.emit(ScanCompleteEvent::EVENT_NAME, event)
            .map_err(|e| e.to_string())
    }

    fn emit_queue_updated(&self, event: QueueUpdatedEvent) -> Result<(), String> {
        use tauri::Emitter;
        self.emit(QueueUpdatedEvent::EVENT_NAME, event)
            .map_err(|e| e.to_string())
    }

    fn emit_queue_state_changed(&self, event: QueueStateChangedEvent) -> Result<(), String> {
        use tauri::Emitter;
        self.emit(QueueStateChangedEvent::EVENT_NAME, event)
            .map_err(|e| e.to_string())
    }

    fn emit_favorites_updated(&self, event: FavoritesUpdatedEvent) -> Result<(), String> {
        use tauri::Emitter;
        self.emit(FavoritesUpdatedEvent::EVENT_NAME, event)
            .map_err(|e| e.to_string())
    }

    fn emit_playlists_updated(&self, event: PlaylistsUpdatedEvent) -> Result<(), String> {
        use tauri::Emitter;
        self.emit(PlaylistsUpdatedEvent::EVENT_NAME, event)
            .map_err(|e| e.to_string())
    }

    fn emit_settings_updated(&self, event: SettingsUpdatedEvent) -> Result<(), String> {
        use tauri::Emitter;
        self.emit(SettingsUpdatedEvent::EVENT_NAME, event)
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== LibraryUpdatedEvent Tests ====================

    #[test]
    fn test_library_updated_event_serialization() {
        let event = LibraryUpdatedEvent::added(vec![1, 2, 3]);
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"action\":\"added\""));
        assert!(json.contains("\"track_ids\":[1,2,3]"));
    }

    #[test]
    fn test_library_updated_event_added() {
        let event = LibraryUpdatedEvent::added(vec![1, 2, 3]);
        assert_eq!(event.action, "added");
        assert_eq!(event.track_ids, vec![1, 2, 3]);
    }

    #[test]
    fn test_library_updated_event_modified() {
        let event = LibraryUpdatedEvent::modified(vec![10, 20]);
        assert_eq!(event.action, "modified");
        assert_eq!(event.track_ids, vec![10, 20]);
    }

    #[test]
    fn test_library_updated_event_deleted() {
        let event = LibraryUpdatedEvent::deleted(vec![5]);
        assert_eq!(event.action, "deleted");
        assert_eq!(event.track_ids, vec![5]);
    }

    #[test]
    fn test_library_updated_event_empty_ids() {
        let event = LibraryUpdatedEvent::added(vec![]);
        assert!(event.track_ids.is_empty());
    }

    #[test]
    fn test_library_updated_event_name() {
        assert_eq!(LibraryUpdatedEvent::EVENT_NAME, "library:updated");
    }

    #[test]
    fn test_library_updated_event_clone() {
        let event = LibraryUpdatedEvent::added(vec![1, 2]);
        let cloned = event.clone();
        assert_eq!(event.action, cloned.action);
        assert_eq!(event.track_ids, cloned.track_ids);
    }

    // ==================== ScanProgressEvent Tests ====================

    #[test]
    fn test_scan_progress_event_serialization() {
        let event = ScanProgressEvent {
            job_id: "job-123".to_string(),
            status: "scanning".to_string(),
            scanned: 100,
            found: 50,
            errors: 2,
            current_path: Some("/music/album".to_string()),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"job_id\":\"job-123\""));
        assert!(json.contains("\"status\":\"scanning\""));
        assert!(json.contains("\"scanned\":100"));
        assert!(json.contains("\"found\":50"));
    }

    #[test]
    fn test_scan_progress_event_without_path() {
        let event = ScanProgressEvent {
            job_id: "job-456".to_string(),
            status: "complete".to_string(),
            scanned: 1000,
            found: 500,
            errors: 0,
            current_path: None,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"current_path\":null"));
    }

    #[test]
    fn test_scan_progress_event_name() {
        assert_eq!(ScanProgressEvent::EVENT_NAME, "library:scan-progress");
    }

    // ==================== ScanCompleteEvent Tests ====================

    #[test]
    fn test_scan_complete_event_serialization() {
        let event = ScanCompleteEvent {
            job_id: "job-789".to_string(),
            added: 250,
            skipped: 50,
            errors: 5,
            duration_ms: 30000,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"added\":250"));
        assert!(json.contains("\"skipped\":50"));
        assert!(json.contains("\"duration_ms\":30000"));
    }

    #[test]
    fn test_scan_complete_event_name() {
        assert_eq!(ScanCompleteEvent::EVENT_NAME, "library:scan-complete");
    }

    // ==================== QueueUpdatedEvent Tests ====================

    #[test]
    fn test_queue_updated_event_serialization() {
        let event = QueueUpdatedEvent::added(vec![0, 1], 5);
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"action\":\"added\""));
        assert!(json.contains("\"queue_length\":5"));
    }

    #[test]
    fn test_queue_updated_event_added() {
        let event = QueueUpdatedEvent::added(vec![0, 1, 2], 10);
        assert_eq!(event.action, "added");
        assert_eq!(event.positions, Some(vec![0, 1, 2]));
        assert_eq!(event.queue_length, 10);
    }

    #[test]
    fn test_queue_updated_event_removed() {
        let event = QueueUpdatedEvent::removed(5, 9);
        assert_eq!(event.action, "removed");
        assert_eq!(event.positions, Some(vec![5]));
        assert_eq!(event.queue_length, 9);
    }

    #[test]
    fn test_queue_updated_event_cleared() {
        let event = QueueUpdatedEvent::cleared();
        assert_eq!(event.action, "cleared");
        assert!(event.positions.is_none());
        assert_eq!(event.queue_length, 0);
    }

    #[test]
    fn test_queue_updated_event_reordered() {
        let event = QueueUpdatedEvent::reordered(2, 5, 10);
        assert_eq!(event.action, "reordered");
        assert_eq!(event.positions, Some(vec![2, 5]));
        assert_eq!(event.queue_length, 10);
    }

    #[test]
    fn test_queue_updated_event_shuffled() {
        let event = QueueUpdatedEvent::shuffled(15);
        assert_eq!(event.action, "shuffled");
        assert!(event.positions.is_none());
        assert_eq!(event.queue_length, 15);
    }

    #[test]
    fn test_queue_updated_event_name() {
        assert_eq!(QueueUpdatedEvent::EVENT_NAME, "queue:updated");
    }

    // ==================== QueueStateChangedEvent Tests ====================

    #[test]
    fn test_queue_state_changed_event() {
        let event = QueueStateChangedEvent::new(5, true, "all".to_string());
        assert_eq!(event.current_index, 5);
        assert!(event.shuffle_enabled);
        assert_eq!(event.loop_mode, "all");
    }

    #[test]
    fn test_queue_state_changed_event_serialization() {
        let event = QueueStateChangedEvent::new(0, false, "none".to_string());
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"current_index\":0"));
        assert!(json.contains("\"shuffle_enabled\":false"));
        assert!(json.contains("\"loop_mode\":\"none\""));
    }

    #[test]
    fn test_queue_state_changed_event_name() {
        assert_eq!(QueueStateChangedEvent::EVENT_NAME, "queue:state-changed");
    }

    #[test]
    fn test_queue_state_changed_loop_modes() {
        for mode in ["none", "one", "all"] {
            let event = QueueStateChangedEvent::new(0, false, mode.to_string());
            assert_eq!(event.loop_mode, mode);
        }
    }

    // ==================== FavoritesUpdatedEvent Tests ====================

    #[test]
    fn test_favorites_updated_event_serialization() {
        let event = FavoritesUpdatedEvent::added(42);
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"action\":\"added\""));
        assert!(json.contains("\"track_id\":42"));
    }

    #[test]
    fn test_favorites_updated_event_added() {
        let event = FavoritesUpdatedEvent::added(123);
        assert_eq!(event.action, "added");
        assert_eq!(event.track_id, 123);
    }

    #[test]
    fn test_favorites_updated_event_removed() {
        let event = FavoritesUpdatedEvent::removed(456);
        assert_eq!(event.action, "removed");
        assert_eq!(event.track_id, 456);
    }

    #[test]
    fn test_favorites_updated_event_name() {
        assert_eq!(FavoritesUpdatedEvent::EVENT_NAME, "favorites:updated");
    }

    // ==================== PlaylistsUpdatedEvent Tests ====================

    #[test]
    fn test_playlists_updated_event_created() {
        let event = PlaylistsUpdatedEvent::created(1);
        assert_eq!(event.action, "created");
        assert_eq!(event.playlist_id, 1);
        assert!(event.track_ids.is_none());
    }

    #[test]
    fn test_playlists_updated_event_renamed() {
        let event = PlaylistsUpdatedEvent::renamed(2);
        assert_eq!(event.action, "renamed");
        assert_eq!(event.playlist_id, 2);
    }

    #[test]
    fn test_playlists_updated_event_deleted() {
        let event = PlaylistsUpdatedEvent::deleted(3);
        assert_eq!(event.action, "deleted");
        assert_eq!(event.playlist_id, 3);
    }

    #[test]
    fn test_playlists_updated_event_tracks_added() {
        let event = PlaylistsUpdatedEvent::tracks_added(4, vec![10, 20, 30]);
        assert_eq!(event.action, "tracks_added");
        assert_eq!(event.playlist_id, 4);
        assert_eq!(event.track_ids, Some(vec![10, 20, 30]));
    }

    #[test]
    fn test_playlists_updated_event_tracks_removed() {
        let event = PlaylistsUpdatedEvent::tracks_removed(5, vec![15, 25]);
        assert_eq!(event.action, "tracks_removed");
        assert_eq!(event.playlist_id, 5);
        assert_eq!(event.track_ids, Some(vec![15, 25]));
    }

    #[test]
    fn test_playlists_updated_event_reordered() {
        let event = PlaylistsUpdatedEvent::reordered(6);
        assert_eq!(event.action, "reordered");
        assert_eq!(event.playlist_id, 6);
        assert!(event.track_ids.is_none());
    }

    #[test]
    fn test_playlists_updated_event_serialization() {
        let event = PlaylistsUpdatedEvent::tracks_added(1, vec![1, 2]);
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"action\":\"tracks_added\""));
        assert!(json.contains("\"playlist_id\":1"));
        assert!(json.contains("\"track_ids\":[1,2]"));
    }

    #[test]
    fn test_playlists_updated_event_name() {
        assert_eq!(PlaylistsUpdatedEvent::EVENT_NAME, "playlists:updated");
    }

    // ==================== SettingsUpdatedEvent Tests ====================

    #[test]
    fn test_settings_updated_event_serialization() {
        let event = SettingsUpdatedEvent::new(
            "volume".to_string(),
            serde_json::json!(0.8),
            Some(serde_json::json!(0.5)),
        );
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"key\":\"volume\""));
        assert!(json.contains("\"value\":0.8"));
    }

    #[test]
    fn test_settings_updated_event_without_previous() {
        let event = SettingsUpdatedEvent::new(
            "theme".to_string(),
            serde_json::json!("dark"),
            None,
        );
        assert_eq!(event.key, "theme");
        assert_eq!(event.value, serde_json::json!("dark"));
        assert!(event.previous_value.is_none());
    }

    #[test]
    fn test_settings_updated_event_with_object_value() {
        let event = SettingsUpdatedEvent::new(
            "columns".to_string(),
            serde_json::json!({"title": true, "artist": true}),
            None,
        );
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"key\":\"columns\""));
    }

    #[test]
    fn test_settings_updated_event_name() {
        assert_eq!(SettingsUpdatedEvent::EVENT_NAME, "settings:updated");
    }

    // ==================== LastfmAuthEvent Tests ====================

    #[test]
    fn test_lastfm_auth_event_authenticated() {
        let event = LastfmAuthEvent::authenticated("testuser".to_string());
        assert_eq!(event.state, "authenticated");
        assert_eq!(event.username, Some("testuser".to_string()));
    }

    #[test]
    fn test_lastfm_auth_event_disconnected() {
        let event = LastfmAuthEvent::disconnected();
        assert_eq!(event.state, "disconnected");
        assert!(event.username.is_none());
    }

    #[test]
    fn test_lastfm_auth_event_pending() {
        let event = LastfmAuthEvent::pending();
        assert_eq!(event.state, "pending");
        assert!(event.username.is_none());
    }

    #[test]
    fn test_lastfm_auth_event_serialization() {
        let event = LastfmAuthEvent::authenticated("user123".to_string());
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"state\":\"authenticated\""));
        assert!(json.contains("\"username\":\"user123\""));
    }

    #[test]
    fn test_lastfm_auth_event_name() {
        assert_eq!(LastfmAuthEvent::EVENT_NAME, "lastfm:auth");
    }

    // ==================== ScrobbleStatusEvent Tests ====================

    #[test]
    fn test_scrobble_status_event_success() {
        let event = ScrobbleStatusEvent::success("Artist".to_string(), "Track".to_string());
        assert_eq!(event.status, "success");
        assert_eq!(event.artist, "Artist");
        assert_eq!(event.track, "Track");
        assert!(event.message.is_none());
    }

    #[test]
    fn test_scrobble_status_event_queued() {
        let event = ScrobbleStatusEvent::queued("Artist".to_string(), "Track".to_string());
        assert_eq!(event.status, "queued");
        assert_eq!(event.message, Some("Queued for retry".to_string()));
    }

    #[test]
    fn test_scrobble_status_event_failed() {
        let event = ScrobbleStatusEvent::failed(
            "Artist".to_string(),
            "Track".to_string(),
            "Network error".to_string(),
        );
        assert_eq!(event.status, "failed");
        assert_eq!(event.message, Some("Network error".to_string()));
    }

    #[test]
    fn test_scrobble_status_event_serialization() {
        let event = ScrobbleStatusEvent::success("Test Artist".to_string(), "Test Track".to_string());
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"status\":\"success\""));
        assert!(json.contains("\"artist\":\"Test Artist\""));
        assert!(json.contains("\"track\":\"Test Track\""));
    }

    #[test]
    fn test_scrobble_status_event_name() {
        assert_eq!(ScrobbleStatusEvent::EVENT_NAME, "lastfm:scrobble-status");
    }

    // ==================== LastfmQueueUpdatedEvent Tests ====================

    #[test]
    fn test_lastfm_queue_updated_event() {
        let event = LastfmQueueUpdatedEvent::new(5);
        assert_eq!(event.queued_count, 5);
    }

    #[test]
    fn test_lastfm_queue_updated_event_zero() {
        let event = LastfmQueueUpdatedEvent::new(0);
        assert_eq!(event.queued_count, 0);
    }

    #[test]
    fn test_lastfm_queue_updated_event_serialization() {
        let event = LastfmQueueUpdatedEvent::new(10);
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"queued_count\":10"));
    }

    #[test]
    fn test_lastfm_queue_updated_event_name() {
        assert_eq!(LastfmQueueUpdatedEvent::EVENT_NAME, "lastfm:queue-updated");
    }

    // ==================== Event Name Consistency Tests ====================

    #[test]
    fn test_all_event_names_follow_convention() {
        // All event names should follow "domain:action" pattern
        let event_names = [
            LibraryUpdatedEvent::EVENT_NAME,
            ScanProgressEvent::EVENT_NAME,
            ScanCompleteEvent::EVENT_NAME,
            QueueUpdatedEvent::EVENT_NAME,
            QueueStateChangedEvent::EVENT_NAME,
            FavoritesUpdatedEvent::EVENT_NAME,
            PlaylistsUpdatedEvent::EVENT_NAME,
            SettingsUpdatedEvent::EVENT_NAME,
            LastfmAuthEvent::EVENT_NAME,
            ScrobbleStatusEvent::EVENT_NAME,
            LastfmQueueUpdatedEvent::EVENT_NAME,
        ];

        for name in event_names {
            assert!(name.contains(':'), "Event name '{}' should contain ':'", name);
            let parts: Vec<&str> = name.split(':').collect();
            assert_eq!(parts.len(), 2, "Event name '{}' should have exactly one ':'", name);
            assert!(!parts[0].is_empty(), "Event name '{}' should have non-empty domain", name);
            assert!(!parts[1].is_empty(), "Event name '{}' should have non-empty action", name);
        }
    }

    // ==================== Clone and Debug Tests ====================

    #[test]
    fn test_all_events_are_clone() {
        let _ = LibraryUpdatedEvent::added(vec![1]).clone();
        let _ = QueueUpdatedEvent::added(vec![0], 1).clone();
        let _ = FavoritesUpdatedEvent::added(1).clone();
        let _ = PlaylistsUpdatedEvent::created(1).clone();
        let _ = QueueStateChangedEvent::new(0, false, "none".to_string()).clone();
        let _ = LastfmAuthEvent::authenticated("user".to_string()).clone();
        let _ = ScrobbleStatusEvent::success("a".to_string(), "t".to_string()).clone();
        let _ = LastfmQueueUpdatedEvent::new(0).clone();
    }

    #[test]
    fn test_all_events_are_debug() {
        let debug = format!("{:?}", LibraryUpdatedEvent::added(vec![1]));
        assert!(debug.contains("LibraryUpdatedEvent"));

        let debug = format!("{:?}", QueueUpdatedEvent::cleared());
        assert!(debug.contains("QueueUpdatedEvent"));

        let debug = format!("{:?}", FavoritesUpdatedEvent::added(1));
        assert!(debug.contains("FavoritesUpdatedEvent"));
    }
}
