//! Tauri command adapters for queue management.
//!
//! These commands expose queue operations to the frontend, replacing the
//! Python FastAPI queue routes.
//!
//! The orchestration — which rows a request touches, which positions a write
//! landed on, the order a request's announcements go out in, and the queue's
//! state machine around each of them — lives in `mt_core::queue`. What stays
//! here is the desktop's half of the boundary: command signatures, tracing
//! spans, and the two seams the core asks the desktop for. [`EventBridge`]
//! turns the core's announcements into `queue:updated` / `queue:state_changed`
//! events; [`AudioSink`] lets a navigation request start a file.
//!
//! Both bridges are deliberately thin. An announcement's payload is decided in
//! core so a core test can pin it; the mapping here is one event constructor
//! per method.

use tauri::{AppHandle, State};

use crate::cache::NetworkFileCache;
use crate::commands::audio::AudioState;
use crate::db::{Database, QueueState, queue};
use crate::events::{EventEmitter, QueueStateChangedEvent, QueueUpdatedEvent};

/// The core queue layer, aliased so that a bare `queue::` keeps meaning the SQL
/// layer (`crate::db::queue`) as it did before the extraction.
use mt_core::queue as core_queue;
use mt_core::queue::{PlaybackSink, QueueReporter};

// The response shapes are core types, re-exported so the command signatures
// below keep naming them at this path.
pub use mt_core::queue::{
    PlayContextResponse, QueueAddFilesResponse, QueueAddResponse, QueueNavigationResult,
    QueueOperationResponse, QueueResponse, QueueStateSnapshot,
};

/// The audio engine, behind the seam the core's navigation functions ask for.
///
/// Bundles the three desktop handles a navigation command is given: the player,
/// the network-file cache a streamed track resolves through, and the app handle
/// the player emits its own events on.
struct AudioSink<'a> {
    audio: &'a AudioState,
    cache: &'a NetworkFileCache,
    app: &'a AppHandle,
}

impl PlaybackSink for AudioSink<'_> {
    fn load_and_play(&self, filepath: &str, track_id: i64) -> Result<u64, String> {
        let info = self
            .audio
            .load_and_play(filepath, Some(track_id), self.cache, self.app)?;
        Ok(info.duration_ms)
    }
}

/// Announcements, bridged onto the events the frontend's queue store listens for.
struct EventBridge<'a> {
    app: &'a AppHandle,
}

impl QueueReporter for EventBridge<'_> {
    fn added(&self, positions: Vec<i64>, queue_length: i64) {
        let _ = self
            .app
            .emit_queue_updated(QueueUpdatedEvent::added(positions, queue_length));
    }

    fn removed(&self, position: i64, queue_length: i64) {
        let _ = self
            .app
            .emit_queue_updated(QueueUpdatedEvent::removed(position, queue_length));
    }

    fn cleared(&self) {
        let _ = self.app.emit_queue_updated(QueueUpdatedEvent::cleared());
    }

    fn shuffled(&self, queue_length: i64) {
        let _ = self
            .app
            .emit_queue_updated(QueueUpdatedEvent::shuffled(queue_length));
    }

    fn reordered(&self, from_position: i64, to_position: i64, queue_length: i64) {
        let _ = self.app.emit_queue_updated(QueueUpdatedEvent::reordered(
            from_position,
            to_position,
            queue_length,
        ));
    }

    fn state_changed(&self, current_index: i64, shuffle_enabled: bool, loop_mode: &str) {
        let _ = self
            .app
            .emit_queue_state_changed(QueueStateChangedEvent::new(
                current_index,
                shuffle_enabled,
                loop_mode.to_string(),
            ));
    }
}

/// Get the current playback queue with track metadata
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn queue_get(db: State<'_, Database>) -> Result<QueueResponse, String> {
    core_queue::get(&db)
}

/// Add tracks to the queue by track IDs
#[tracing::instrument(skip(app, db, track_ids))]
#[tauri::command]
pub(crate) fn queue_add(
    app: AppHandle,
    db: State<'_, Database>,
    track_ids: Vec<i64>,
    position: Option<i64>,
) -> Result<QueueAddResponse, String> {
    core_queue::add_tracks(&db, &track_ids, position, &EventBridge { app: &app })
}

/// Add files directly to the queue (for drag-and-drop support)
#[tracing::instrument(skip(app, db, filepaths))]
#[tauri::command]
pub(crate) fn queue_add_files(
    app: AppHandle,
    db: State<'_, Database>,
    filepaths: Vec<String>,
    position: Option<i64>,
) -> Result<QueueAddFilesResponse, String> {
    core_queue::add_files(&db, &filepaths, position, &EventBridge { app: &app })
}

/// Remove a track from the queue by position
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_remove(
    app: AppHandle,
    db: State<'_, Database>,
    position: i64,
) -> Result<(), String> {
    core_queue::remove_track(&db, position, &EventBridge { app: &app })
}

/// Clear the entire queue
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_clear(app: AppHandle, db: State<'_, Database>) -> Result<(), String> {
    core_queue::clear(&db, &EventBridge { app: &app })
}

/// Reorder tracks in the queue (move from one position to another)
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_reorder(
    app: AppHandle,
    db: State<'_, Database>,
    from_position: i64,
    to_position: i64,
) -> Result<QueueOperationResponse, String> {
    core_queue::reorder(&db, from_position, to_position, &EventBridge { app: &app })
}

/// Shuffle the queue using Fisher-Yates algorithm
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_shuffle(
    app: AppHandle,
    db: State<'_, Database>,
    keep_current: Option<bool>,
) -> Result<QueueOperationResponse, String> {
    core_queue::shuffle(&db, keep_current, &EventBridge { app: &app })
}

/// Get queue playback state
#[tracing::instrument(level = "trace", skip(db))]
#[tauri::command]
pub(crate) fn queue_get_playback_state(db: State<'_, Database>) -> Result<QueueState, String> {
    core_queue::get_playback_state(&db)
}

/// Set current index in queue playback state
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_set_current_index(
    app: AppHandle,
    db: State<'_, Database>,
    index: i64,
) -> Result<(), String> {
    core_queue::set_current_index(&db, index, &EventBridge { app: &app })
}

/// Toggle shuffle on/off with full state machine: saves/restores original order,
/// pins current track at index 0 and play-next tracks after it when enabling.
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_set_shuffle(
    app: AppHandle,
    db: State<'_, Database>,
    enabled: bool,
) -> Result<QueueStateSnapshot, String> {
    core_queue::set_shuffle(&db, enabled, &EventBridge { app: &app })
}

/// Set loop mode in queue playback state
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_set_loop(
    app: AppHandle,
    db: State<'_, Database>,
    mode: String,
) -> Result<(), String> {
    core_queue::set_loop(&db, &mode, &EventBridge { app: &app })
}

/// Add tracks as "play next" with move semantics and offset tracking
#[tracing::instrument(skip(app, db))]
#[tauri::command]
pub(crate) fn queue_add_play_next(
    app: AppHandle,
    db: State<'_, Database>,
    track_ids: Vec<i64>,
) -> Result<QueueStateSnapshot, String> {
    core_queue::add_play_next(&db, &track_ids, &EventBridge { app: &app })
}

/// Play the next track in the queue with full state machine logic
#[tracing::instrument(skip(app, db, audio, cache))]
#[tauri::command]
pub(crate) fn queue_play_next_track(
    app: AppHandle,
    db: State<'_, Database>,
    audio: State<'_, AudioState>,
    cache: State<'_, NetworkFileCache>,
) -> Result<QueueNavigationResult, String> {
    core_queue::play_next(
        &db,
        &AudioSink {
            audio: &audio,
            cache: &cache,
            app: &app,
        },
        &EventBridge { app: &app },
    )
}

/// Play the previous track in the queue
#[tracing::instrument(skip(app, db, audio, cache))]
#[tauri::command]
pub(crate) fn queue_play_previous_track(
    app: AppHandle,
    db: State<'_, Database>,
    audio: State<'_, AudioState>,
    cache: State<'_, NetworkFileCache>,
    current_time_ms: u64,
) -> Result<QueueNavigationResult, String> {
    core_queue::play_previous(
        &db,
        current_time_ms,
        &AudioSink {
            audio: &audio,
            cache: &cache,
            app: &app,
        },
        &EventBridge { app: &app },
    )
}

/// Skip to next track, overriding repeat-one mode
#[tracing::instrument(skip(app, db, audio, cache))]
#[tauri::command]
pub(crate) fn queue_skip_next(
    app: AppHandle,
    db: State<'_, Database>,
    audio: State<'_, AudioState>,
    cache: State<'_, NetworkFileCache>,
) -> Result<QueueNavigationResult, String> {
    core_queue::skip_next(
        &db,
        &AudioSink {
            audio: &audio,
            cache: &cache,
            app: &app,
        },
        &EventBridge { app: &app },
    )
}

/// Skip to previous track, overriding repeat-one mode
#[tracing::instrument(skip(app, db, audio, cache))]
#[tauri::command]
pub(crate) fn queue_skip_previous(
    app: AppHandle,
    db: State<'_, Database>,
    audio: State<'_, AudioState>,
    cache: State<'_, NetworkFileCache>,
    current_time_ms: u64,
) -> Result<QueueNavigationResult, String> {
    core_queue::skip_previous(
        &db,
        current_time_ms,
        &AudioSink {
            audio: &audio,
            cache: &cache,
            app: &app,
        },
        &EventBridge { app: &app },
    )
}

/// Check queue integrity and repair issues
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn queue_check_integrity(
    db: State<'_, Database>,
) -> Result<queue::IntegrityReport, String> {
    core_queue::check_integrity(&db)
}

/// Atomically replace the queue with a new play context and start playback.
///
/// Clears the queue, installs all tracks (rotated or shuffled), sets queue
/// state, triggers audio playback on the start track, and emits queue events
/// — all in a single IPC round-trip.
#[tracing::instrument(skip(app, db, audio, cache))]
#[tauri::command]
pub(crate) fn queue_play_context(
    app: AppHandle,
    db: State<'_, Database>,
    audio: State<'_, AudioState>,
    cache: State<'_, NetworkFileCache>,
    track_ids: Vec<i64>,
    start_index: i64,
    shuffle: bool,
) -> Result<PlayContextResponse, String> {
    core_queue::play_context(
        &db,
        &track_ids,
        start_index,
        shuffle,
        &AudioSink {
            audio: &audio,
            cache: &cache,
            app: &app,
        },
        &EventBridge { app: &app },
    )
}

/// Atomically replace the queue using a library query and start playback.
///
/// Runs the library sort/filter query once on the backend, resolves the full
/// ordered ID list, and starts playback on `start_track_id` — all in a single
/// IPC round-trip. Eliminates the N×`library_get_all` calls that
/// `_loadAllPages()` required on the play hot path.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(app, db, audio, cache))]
#[tauri::command]
pub(crate) fn queue_play_context_query(
    app: AppHandle,
    db: State<'_, Database>,
    audio: State<'_, AudioState>,
    cache: State<'_, NetworkFileCache>,
    start_track_id: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    ignore_words: Option<String>,
    shuffle: bool,
) -> Result<PlayContextResponse, String> {
    let request = core_queue::PlayContextQuery {
        start_track_id,
        search,
        sort_by,
        sort_order,
        ignore_words,
        shuffle,
    };

    core_queue::play_context_from_query(
        &db,
        &request,
        &AudioSink {
            audio: &audio,
            cache: &cache,
            app: &app,
        },
        &EventBridge { app: &app },
    )
}
