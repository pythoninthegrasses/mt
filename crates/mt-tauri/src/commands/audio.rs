use crate::audio::device_isolation;
use crate::audio::{AudioEngine, PlaybackState, TrackInfo};
use crate::cache::NetworkFileCache;
use crate::cache::mount_detect::is_network_mount;
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_store::StoreExt;
use tracing::{debug, error, info, warn};

/// Timeout for CoreAudio device resolution on disposable threads.
const DEVICE_RESOLVE_TIMEOUT: Duration = Duration::from_secs(5);

/// Timeout for subprocess device enumeration.
const DEVICE_ENUMERATE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackStatus {
    pub position_ms: u64,
    pub duration_ms: u64,
    pub state: PlaybackState,
    pub volume: f32,
    pub track: Option<TrackInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceListResponse {
    pub devices: Vec<String>,
}

enum AudioCommand {
    Load(String, Option<i64>, Sender<Result<TrackInfo, String>>),
    LoadAndPlay(String, Option<i64>, Sender<Result<TrackInfo, String>>),
    Play(Sender<Result<(), String>>),
    Pause(Sender<Result<(), String>>),
    Stop(Sender<Result<(), String>>),
    Seek(u64, Sender<Result<(), String>>),
    SetVolume(f32, Sender<Result<(), String>>),
    GetVolume(Sender<f32>),
    GetStatus(Sender<PlaybackStatus>),
    /// Device already resolved off the audio thread via device_isolation::resolve_device.
    SetDevice(rodio::cpal::Device, Sender<Result<(), String>>),
}

/// Detects when playback has stalled near the end of a track.
///
/// Some decoders (e.g. symphonia with corrupted MP3 frames) may stop producing
/// samples before the sink fully drains, so `Sink::empty()` never returns true.
/// This detector watches for the position not advancing while near the track end
/// and treats it as finished after a threshold of consecutive stalled polls.
#[derive(Debug)]
struct StallDetector {
    position_ms: u64,
    count: u32,
}

impl StallDetector {
    /// Poll cycles without position change before declaring stalled (~1s at 100ms).
    const THRESHOLD: u32 = 10;
    /// How close to the end the position must be (in ms) to trigger stall detection.
    const END_PROXIMITY_MS: u64 = 5000;

    fn new() -> Self {
        Self {
            position_ms: 0,
            count: 0,
        }
    }

    fn reset(&mut self) {
        self.position_ms = 0;
        self.count = 0;
    }

    /// Check whether the given progress indicates a stall near end-of-track.
    /// Returns true if the position has been stalled long enough to treat as finished.
    fn check(&mut self, position_ms: u64, duration_ms: u64) -> bool {
        if duration_ms == 0 || position_ms == 0 {
            self.count = 0;
            return false;
        }

        if position_ms + Self::END_PROXIMITY_MS < duration_ms {
            self.count = 0;
            return false;
        }

        if position_ms == self.position_ms {
            self.count += 1;
            self.count >= Self::THRESHOLD
        } else {
            self.position_ms = position_ms;
            self.count = 0;
            false
        }
    }
}

struct PlayCountState {
    track_id: Option<i64>,
    threshold_reached: bool,
}

struct ScrobbleState {
    track_id: Option<i64>,
    threshold_reached: bool,
    threshold_percent: f64,
}

pub struct AudioState {
    sender: Sender<AudioCommand>,
}

impl AudioState {
    pub(crate) fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<AudioCommand>();

        thread::spawn(move || {
            audio_thread(rx, app);
        });

        Self { sender: tx }
    }

    fn send_command(&self, cmd: AudioCommand) {
        let _ = self.sender.send(cmd);
    }

    /// Load and start playback of a track.
    ///
    /// Resolves network-cached paths, then sends LoadAndPlay to the audio
    /// thread and blocks until it responds.  Callable from other commands
    /// without going through the Tauri invoke boundary.
    pub(crate) fn load_and_play(
        &self,
        path: &str,
        track_id: Option<i64>,
        cache: &NetworkFileCache,
        app: &AppHandle,
    ) -> Result<TrackInfo, String> {
        let resolved = resolve_cached_path(path, cache, app);
        let (tx, rx) = mpsc::channel();
        self.send_command(AudioCommand::LoadAndPlay(resolved, track_id, tx));
        rx.recv().map_err(|_| "Channel closed".to_string())?
    }
}

fn audio_thread(rx: Receiver<AudioCommand>, app: AppHandle) {
    // Lazy audio engine initialization: defer CoreAudio interaction until the
    // first command that actually needs it.  On macOS, querying the audio
    // device list before the CoreAudio HAL is fully initialized triggers a
    // SIGSEGV inside HALDeviceList::GetData() (null pointer at address 0x4).
    // Because SIGSEGV cannot be caught in Rust, the only safe mitigation is
    // to never call into CoreAudio until the user actually requests audio.
    let mut engine: Option<AudioEngine> = None;
    let mut device_restored = false;

    /// Try to create the audio engine, restoring the saved output device if
    /// one is persisted.  Returns a mutable reference on success or an error
    /// string suitable for sending back over a reply channel.
    ///
    /// All CoreAudio device enumeration (`output_devices()`,
    /// `default_output_device()`) is performed on disposable threads via
    /// `device_isolation::resolve_device`, never on the audio thread itself.
    fn ensure_engine<'a>(
        engine: &'a mut Option<AudioEngine>,
        device_restored: &mut bool,
        app: &AppHandle,
    ) -> Result<&'a mut AudioEngine, String> {
        if engine.is_none() {
            info!("Lazily initializing audio engine on first use");

            // Resolve the default output device on a disposable thread,
            // then create the engine on the audio thread from the resolved
            // device. This keeps device enumeration off the audio thread.
            let device =
                device_isolation::resolve_device(None, DEVICE_RESOLVE_TIMEOUT).map_err(|e| {
                    error!(error = %e, "Failed to resolve default audio device");
                    format!("Audio engine initialization failed: {e}")
                })?;
            let e = AudioEngine::from_device(device).map_err(|e| {
                error!(error = %e, "Failed to create audio engine");
                format!("Audio engine initialization failed: {e}")
            })?;
            *engine = Some(e);
        }

        let eng = engine.as_mut().unwrap();

        // Restore saved audio output device once, on first successful init.
        // Device resolution happens on a disposable thread — never on the
        // audio thread.
        if !*device_restored {
            *device_restored = true;
            if let Ok(store) = app.store("mt-settings.json")
                && let Some(device_value) = store.get("audio_output_device")
                && let Some(device_name) = device_value.as_str()
                && device_name != "default"
            {
                match device_isolation::resolve_device(Some(device_name), DEVICE_RESOLVE_TIMEOUT) {
                    Ok(device) => match eng.set_device_resolved(device) {
                        Ok(()) => {
                            info!(device = device_name, "Restored saved audio output device");
                        }
                        Err(e) => {
                            warn!(
                                device = device_name,
                                error = %e,
                                "Failed to apply saved audio device, using default"
                            );
                        }
                    },
                    Err(e) => {
                        warn!(
                            device = device_name,
                            error = %e,
                            "Saved audio device unavailable, using default"
                        );
                    }
                }
            }
        }

        Ok(eng)
    }

    let mut last_finished = false;
    let mut last_emit = std::time::Instant::now();
    let mut stall = StallDetector::new();
    let mut play_count_state = PlayCountState {
        track_id: None,
        threshold_reached: false,
    };
    let mut scrobble_state = ScrobbleState {
        track_id: None,
        threshold_reached: false,
        threshold_percent: 0.9, // Default 90%
    };

    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(cmd) => match cmd {
                AudioCommand::Load(path, track_id, reply) => {
                    let result = ensure_engine(&mut engine, &mut device_restored, &app)
                        .and_then(|eng| eng.load(&path).map_err(|e| e.to_string()));

                    // Reset play count state for new track
                    play_count_state.track_id = track_id;
                    play_count_state.threshold_reached = false;

                    // Reset scrobble state for new track
                    scrobble_state.track_id = track_id;
                    scrobble_state.threshold_reached = false;

                    stall.reset();
                    last_finished = false;

                    let _ = reply.send(result);
                }
                AudioCommand::LoadAndPlay(path, track_id, reply) => {
                    let result =
                        ensure_engine(&mut engine, &mut device_restored, &app).and_then(|eng| {
                            let info = eng.load(&path).map_err(|e| e.to_string())?;
                            let _ = eng.play();
                            Ok(info)
                        });

                    // Reset play count state for new track
                    play_count_state.track_id = track_id;
                    play_count_state.threshold_reached = false;

                    // Reset scrobble state for new track
                    scrobble_state.track_id = track_id;
                    scrobble_state.threshold_reached = false;

                    stall.reset();
                    last_finished = false;

                    let _ = reply.send(result);
                }
                AudioCommand::Play(reply) => {
                    debug!("Audio thread received Play command");
                    let result =
                        ensure_engine(&mut engine, &mut device_restored, &app).and_then(|eng| {
                            eng.play().map_err(|e| {
                                error!(error = %e, "Audio play failed");
                                e.to_string()
                            })
                        });
                    let _ = reply.send(result);
                }
                AudioCommand::Pause(reply) => {
                    debug!("Audio thread received Pause command");
                    let result =
                        ensure_engine(&mut engine, &mut device_restored, &app).and_then(|eng| {
                            eng.pause().map_err(|e| {
                                error!(error = %e, "Audio pause failed");
                                e.to_string()
                            })
                        });
                    let _ = reply.send(result);
                }
                AudioCommand::Stop(reply) => {
                    debug!("Audio thread received Stop command");
                    if let Some(eng) = engine.as_mut() {
                        eng.stop();
                    }
                    let _ = reply.send(Ok(()));
                }
                AudioCommand::Seek(pos, reply) => {
                    let result = ensure_engine(&mut engine, &mut device_restored, &app)
                        .and_then(|eng| eng.seek(pos).map_err(|e| e.to_string()));
                    let _ = reply.send(result);
                }
                AudioCommand::SetVolume(vol, reply) => {
                    if let Some(eng) = engine.as_mut() {
                        eng.set_volume(vol);
                    }
                    // Volume will be applied when engine initializes if needed
                    let _ = reply.send(Ok(()));
                }
                AudioCommand::GetVolume(reply) => {
                    let vol = engine.as_ref().map_or(1.0, |eng| eng.get_volume());
                    let _ = reply.send(vol);
                }
                AudioCommand::GetStatus(reply) => {
                    let status = match engine.as_ref() {
                        Some(eng) => {
                            let progress = eng.get_progress();
                            let track = eng.get_current_track().cloned();
                            PlaybackStatus {
                                position_ms: progress.position_ms,
                                duration_ms: progress.duration_ms,
                                state: progress.state,
                                volume: eng.get_volume(),
                                track,
                            }
                        }
                        None => PlaybackStatus {
                            position_ms: 0,
                            duration_ms: 0,
                            state: PlaybackState::Stopped,
                            volume: 1.0,
                            track: None,
                        },
                    };
                    let _ = reply.send(status);
                }
                AudioCommand::SetDevice(device, reply) => {
                    let result = ensure_engine(&mut engine, &mut device_restored, &app)
                        .and_then(|eng| eng.set_device_resolved(device).map_err(|e| e.to_string()));
                    let _ = reply.send(result);
                }
            },
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        let is_playing = engine
            .as_ref()
            .is_some_and(|e| e.get_state() == PlaybackState::Playing);
        let mut is_finished = engine.as_ref().is_some_and(|e| e.is_finished());

        // Stall detection: if position hasn't advanced and we're near the
        // end of the track, the decoder may be stuck (e.g. symphonia MP3
        // decode error preventing sink from draining). Treat as finished.
        if !is_finished
            && engine
                .as_ref()
                .is_some_and(|e| e.get_state() == PlaybackState::Playing)
            && let Some(ref eng) = engine
        {
            let progress = eng.get_progress();
            if stall.check(progress.position_ms, progress.duration_ms) {
                debug!(
                    position_ms = progress.position_ms,
                    duration_ms = progress.duration_ms,
                    "Position stalled near end of track, treating as finished"
                );
                is_finished = true;
            }
        }

        if is_playing && last_emit.elapsed() >= Duration::from_millis(250) {
            let progress = engine.as_ref().unwrap().get_progress();
            let _ = app.emit("audio://progress", &progress);
            last_emit = std::time::Instant::now();

            // Check play count threshold (75%)
            if !play_count_state.threshold_reached
                && progress.duration_ms > 0
                && play_count_state.track_id.is_some()
            {
                let ratio = progress.position_ms as f64 / progress.duration_ms as f64;

                if ratio >= 0.75
                    && let Some(track_id) = play_count_state.track_id
                {
                    // Spawn async task to avoid blocking audio thread
                    let app_handle = app.clone();
                    std::thread::spawn(move || {
                        use crate::db::Database;
                        use crate::db::library;

                        let db = app_handle.state::<Database>();
                        if let Ok(conn) = db.conn() {
                            let _ = library::update_play_count(&conn, track_id);
                            debug!(track_id, "Play count updated");
                        }
                    });
                    play_count_state.threshold_reached = true;
                }
            }

            // Check scrobble threshold (90% default, configurable)
            if !scrobble_state.threshold_reached
                && progress.duration_ms > 0
                && scrobble_state.track_id.is_some()
            {
                let ratio = progress.position_ms as f64 / progress.duration_ms as f64;

                if ratio >= scrobble_state.threshold_percent
                    && let Some(track_id) = scrobble_state.track_id
                {
                    // Spawn async task to avoid blocking audio thread
                    let app_handle = app.clone();
                    std::thread::spawn(move || {
                        use crate::commands::lastfm;
                        use crate::db::Database;

                        let db = app_handle.state::<Database>();
                        if let Ok(conn) = db.conn() {
                            // Queue scrobble from audio thread
                            match lastfm::scrobble_from_audio_thread(&app_handle, &conn, track_id) {
                                Ok(_) => debug!(track_id, "Scrobble queued"),
                                Err(e) => error!(track_id, error = %e, "Failed to queue scrobble"),
                            }
                        }
                    });
                    scrobble_state.threshold_reached = true;
                }
            }
        }

        if is_finished && !last_finished {
            debug!("Track finished, emitting audio://track-ended");
            let _ = app.emit("audio://track-ended", ());
        }
        last_finished = is_finished;
    }
}

/// If network caching is enabled and the path is on a network mount,
/// copy the file to the local cache and return the cached path.
/// Otherwise return the original path unchanged.
fn resolve_cached_path(path: &str, cache: &NetworkFileCache, app: &AppHandle) -> String {
    let enabled = app
        .store("settings.json")
        .ok()
        .and_then(|s| s.get("network_cache_enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if !enabled {
        return path.to_string();
    }

    if !is_network_mount(path) {
        return path.to_string();
    }

    match cache.get_or_cache(path) {
        Ok(cached) => {
            let cached_str = cached.to_string_lossy().to_string();
            debug!(source = path, cached = %cached_str, "Using cached network file");
            cached_str
        }
        Err(e) => {
            warn!(source = path, error = %e, "Failed to cache network file, using original");
            path.to_string()
        }
    }
}

#[tracing::instrument(skip(state, cache, app))]
#[tauri::command]
pub(crate) fn audio_load(
    path: String,
    track_id: Option<i64>,
    state: State<AudioState>,
    cache: State<NetworkFileCache>,
    app: AppHandle,
) -> Result<TrackInfo, String> {
    let resolved = resolve_cached_path(&path, &cache, &app);
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::Load(resolved, track_id, tx));
    rx.recv().map_err(|_| "Channel closed".to_string())?
}

#[tracing::instrument(skip(state, cache, app))]
#[tauri::command]
pub(crate) fn audio_load_and_play(
    path: String,
    track_id: Option<i64>,
    state: State<AudioState>,
    cache: State<NetworkFileCache>,
    app: AppHandle,
) -> Result<TrackInfo, String> {
    let resolved = resolve_cached_path(&path, &cache, &app);
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::LoadAndPlay(resolved, track_id, tx));
    rx.recv().map_err(|_| "Channel closed".to_string())?
}

#[tracing::instrument(skip(state))]
#[tauri::command]
pub(crate) fn audio_play(state: State<AudioState>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::Play(tx));
    rx.recv().map_err(|_| "Channel closed".to_string())?
}

#[tracing::instrument(skip(state))]
#[tauri::command]
pub(crate) fn audio_pause(state: State<AudioState>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::Pause(tx));
    rx.recv().map_err(|_| "Channel closed".to_string())?
}

#[tracing::instrument(skip(state))]
#[tauri::command]
pub(crate) fn audio_stop(state: State<AudioState>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::Stop(tx));
    rx.recv().map_err(|_| "Channel closed".to_string())?
}

#[tracing::instrument(skip(state))]
#[tauri::command]
pub(crate) fn audio_seek(position_ms: u64, state: State<AudioState>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::Seek(position_ms, tx));
    rx.recv().map_err(|_| "Channel closed".to_string())?
}

#[tracing::instrument(skip(state))]
#[tauri::command]
pub(crate) fn audio_set_volume(volume: f32, state: State<AudioState>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::SetVolume(volume, tx));
    rx.recv().map_err(|_| "Channel closed".to_string())?
}

#[tracing::instrument(level = "trace", skip(state))]
#[tauri::command]
pub(crate) fn audio_get_volume(state: State<AudioState>) -> f32 {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::GetVolume(tx));
    rx.recv().unwrap_or(1.0)
}

#[tracing::instrument(level = "trace", skip(state))]
#[tauri::command]
pub(crate) fn audio_get_status(state: State<AudioState>) -> PlaybackStatus {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::GetStatus(tx));
    rx.recv().unwrap_or(PlaybackStatus {
        position_ms: 0,
        duration_ms: 0,
        state: PlaybackState::Stopped,
        volume: 1.0,
        track: None,
    })
}

#[derive(Serialize)]
pub(crate) struct CacheStatusResponse {
    pub enabled: bool,
    pub persistent: bool,
    pub max_bytes: u64,
    pub used_bytes: u64,
    pub file_count: usize,
}

#[tracing::instrument(skip(cache, app))]
#[tauri::command]
pub(crate) fn network_cache_status(
    cache: State<NetworkFileCache>,
    app: AppHandle,
) -> Result<CacheStatusResponse, String> {
    let store = app
        .store("settings.json")
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    let enabled = store
        .get("network_cache_enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let persistent = store
        .get("network_cache_persistent")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let max_gb = store
        .get("network_cache_max_gb")
        .and_then(|v| v.as_f64())
        .unwrap_or(2.0);

    Ok(CacheStatusResponse {
        enabled,
        persistent,
        max_bytes: (max_gb * 1_073_741_824.0) as u64,
        used_bytes: cache.current_size_bytes(),
        file_count: cache.entry_count(),
    })
}

#[tracing::instrument(skip(cache))]
#[tauri::command]
pub(crate) fn network_cache_purge(cache: State<NetworkFileCache>) -> Result<(), String> {
    cache
        .purge()
        .map_err(|e| format!("Failed to purge cache: {}", e))
}

/// List audio output devices via crash-isolated subprocess.
///
/// Device enumeration runs in a subprocess so that a CoreAudio HAL crash
/// (SIGSEGV in `HALDeviceList::GetData()`) kills only the subprocess, not
/// the main mt process. Does NOT route through the audio thread.
#[tracing::instrument]
#[tauri::command]
pub(crate) fn audio_list_devices() -> Result<DeviceListResponse, String> {
    let devices =
        device_isolation::safe_list_output_devices(DEVICE_ENUMERATE_TIMEOUT).map_err(|e| {
            error!(error = %e, "Failed to enumerate audio devices");
            e.to_string()
        })?;
    Ok(DeviceListResponse { devices })
}

/// Switch audio output device. Device resolution happens on a disposable
/// thread (not the audio thread) via `device_isolation::resolve_device`.
#[tracing::instrument(skip(state, app))]
#[tauri::command]
pub(crate) fn audio_set_device(
    device_name: Option<String>,
    state: State<AudioState>,
    app: AppHandle,
) -> Result<(), String> {
    // Resolve the cpal::Device off the audio thread (disposable thread).
    let device = device_isolation::resolve_device(device_name.as_deref(), DEVICE_RESOLVE_TIMEOUT)
        .map_err(|e| {
        error!(error = %e, "Failed to resolve audio device");
        e.to_string()
    })?;

    if let Some(ref name) = device_name {
        info!(device = %name, "Switching audio output device");
    } else {
        info!("Switching to default audio output device");
    }

    // Send pre-resolved device to the audio thread for stream creation.
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::SetDevice(device, tx));
    rx.recv().map_err(|_| "Channel closed".to_string())??;

    // Persist selection to settings store
    let store = app
        .store("mt-settings.json")
        .map_err(|e| format!("Failed to open settings store: {}", e))?;
    let value = device_name.unwrap_or_else(|| "default".to_string());
    store.set("audio_output_device", serde_json::json!(value));
    store
        .save()
        .map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== PlaybackStatus Tests ====================

    #[test]
    fn test_playback_status_default_values() {
        let status = PlaybackStatus {
            position_ms: 0,
            duration_ms: 0,
            state: PlaybackState::Stopped,
            volume: 1.0,
            track: None,
        };

        assert_eq!(status.position_ms, 0);
        assert_eq!(status.duration_ms, 0);
        assert_eq!(status.state, PlaybackState::Stopped);
        assert_eq!(status.volume, 1.0);
        assert!(status.track.is_none());
    }

    #[test]
    fn test_playback_status_with_track() {
        let track = TrackInfo {
            path: "/music/song.mp3".to_string(),
            duration_ms: 180000,
            sample_rate: 44100,
            channels: 2,
        };

        let status = PlaybackStatus {
            position_ms: 30000,
            duration_ms: 180000,
            state: PlaybackState::Playing,
            volume: 0.8,
            track: Some(track),
        };

        assert_eq!(status.position_ms, 30000);
        assert_eq!(status.state, PlaybackState::Playing);
        assert!(status.track.is_some());
        assert_eq!(status.track.as_ref().unwrap().path, "/music/song.mp3");
    }

    #[test]
    fn test_playback_status_serialization() {
        let status = PlaybackStatus {
            position_ms: 45000,
            duration_ms: 200000,
            state: PlaybackState::Playing,
            volume: 0.75,
            track: None,
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"position_ms\":45000"));
        assert!(json.contains("\"duration_ms\":200000"));
        assert!(json.contains("\"state\":\"Playing\""));
        assert!(json.contains("\"volume\":0.75"));
        assert!(json.contains("\"track\":null"));
    }

    #[test]
    fn test_playback_status_serialization_with_track() {
        let track = TrackInfo {
            path: "/test.mp3".to_string(),
            duration_ms: 60000,
            sample_rate: 48000,
            channels: 2,
        };

        let status = PlaybackStatus {
            position_ms: 10000,
            duration_ms: 60000,
            state: PlaybackState::Paused,
            volume: 1.0,
            track: Some(track),
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"path\":\"/test.mp3\""));
        assert!(json.contains("\"state\":\"Paused\""));
    }

    #[test]
    fn test_playback_status_deserialization() {
        let json = r#"{
            "position_ms": 90000,
            "duration_ms": 240000,
            "state": "Paused",
            "volume": 0.5,
            "track": null
        }"#;

        let status: PlaybackStatus = serde_json::from_str(json).unwrap();
        assert_eq!(status.position_ms, 90000);
        assert_eq!(status.duration_ms, 240000);
        assert_eq!(status.state, PlaybackState::Paused);
        assert_eq!(status.volume, 0.5);
        assert!(status.track.is_none());
    }

    #[test]
    fn test_playback_status_clone() {
        let status = PlaybackStatus {
            position_ms: 5000,
            duration_ms: 10000,
            state: PlaybackState::Playing,
            volume: 0.9,
            track: None,
        };

        let cloned = status.clone();
        assert_eq!(status.position_ms, cloned.position_ms);
        assert_eq!(status.volume, cloned.volume);
    }

    #[test]
    fn test_playback_status_all_states() {
        for state in [
            PlaybackState::Stopped,
            PlaybackState::Playing,
            PlaybackState::Paused,
        ] {
            let status = PlaybackStatus {
                position_ms: 0,
                duration_ms: 1000,
                state,
                volume: 1.0,
                track: None,
            };
            assert_eq!(status.state, state);
        }
    }

    #[test]
    fn test_playback_status_volume_range() {
        // Test minimum volume
        let min_vol = PlaybackStatus {
            position_ms: 0,
            duration_ms: 0,
            state: PlaybackState::Stopped,
            volume: 0.0,
            track: None,
        };
        assert_eq!(min_vol.volume, 0.0);

        // Test maximum volume
        let max_vol = PlaybackStatus {
            position_ms: 0,
            duration_ms: 0,
            state: PlaybackState::Stopped,
            volume: 1.0,
            track: None,
        };
        assert_eq!(max_vol.volume, 1.0);

        // Test mid-range volume
        let mid_vol = PlaybackStatus {
            position_ms: 0,
            duration_ms: 0,
            state: PlaybackState::Stopped,
            volume: 0.5,
            track: None,
        };
        assert_eq!(mid_vol.volume, 0.5);
    }

    #[test]
    fn test_playback_status_position_at_end() {
        let status = PlaybackStatus {
            position_ms: 180000,
            duration_ms: 180000,
            state: PlaybackState::Stopped,
            volume: 1.0,
            track: None,
        };

        assert_eq!(status.position_ms, status.duration_ms);
    }

    #[test]
    fn test_playback_status_debug() {
        let status = PlaybackStatus {
            position_ms: 0,
            duration_ms: 0,
            state: PlaybackState::Stopped,
            volume: 1.0,
            track: None,
        };

        let debug = format!("{:?}", status);
        assert!(debug.contains("PlaybackStatus"));
        assert!(debug.contains("Stopped"));
    }

    // ==================== AudioCommand Tests ====================

    #[test]
    fn test_audio_command_enum_variants() {
        // Test that all AudioCommand variants can be constructed
        let (tx, _rx) = mpsc::channel::<Result<TrackInfo, String>>();
        let _load = AudioCommand::Load("/test.mp3".to_string(), Some(1), tx);

        let (tx, _rx) = mpsc::channel::<Result<(), String>>();
        let _play = AudioCommand::Play(tx);

        let (tx, _rx) = mpsc::channel::<Result<(), String>>();
        let _pause = AudioCommand::Pause(tx);

        let (tx, _rx) = mpsc::channel::<Result<(), String>>();
        let _stop = AudioCommand::Stop(tx);

        let (tx, _rx) = mpsc::channel::<Result<(), String>>();
        let _seek = AudioCommand::Seek(1000, tx);

        let (tx, _rx) = mpsc::channel::<Result<(), String>>();
        let _set_vol = AudioCommand::SetVolume(0.5, tx);

        let (tx, _rx) = mpsc::channel::<f32>();
        let _get_vol = AudioCommand::GetVolume(tx);

        let (tx, _rx) = mpsc::channel::<PlaybackStatus>();
        let _get_status = AudioCommand::GetStatus(tx);
    }

    #[test]
    fn test_audio_command_load_with_track_id() {
        let (tx, rx) = mpsc::channel::<Result<TrackInfo, String>>();
        let cmd = AudioCommand::Load("/music/track.mp3".to_string(), Some(42), tx);

        // Verify command can be sent (tests Send trait)
        match cmd {
            AudioCommand::Load(path, track_id, sender) => {
                assert_eq!(path, "/music/track.mp3");
                assert_eq!(track_id, Some(42));
                // Send a response to verify sender works
                let _ = sender.send(Ok(TrackInfo {
                    path: "/music/track.mp3".to_string(),
                    duration_ms: 180000,
                    sample_rate: 44100,
                    channels: 2,
                }));
            }
            _ => panic!("Wrong command variant"),
        }

        let result = rx.recv().unwrap();
        assert!(result.is_ok());
    }

    #[test]
    fn test_audio_command_load_without_track_id() {
        let (tx, _rx) = mpsc::channel::<Result<TrackInfo, String>>();
        let cmd = AudioCommand::Load("/test.mp3".to_string(), None, tx);

        match cmd {
            AudioCommand::Load(_, track_id, _) => {
                assert!(track_id.is_none());
            }
            _ => panic!("Wrong command variant"),
        }
    }

    #[test]
    fn test_audio_command_seek_position() {
        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        let cmd = AudioCommand::Seek(30000, tx);

        match cmd {
            AudioCommand::Seek(pos, sender) => {
                assert_eq!(pos, 30000);
                let _ = sender.send(Ok(()));
            }
            _ => panic!("Wrong command variant"),
        }

        assert!(rx.recv().unwrap().is_ok());
    }

    #[test]
    fn test_audio_command_set_volume_values() {
        for vol in [0.0f32, 0.25, 0.5, 0.75, 1.0] {
            let (tx, rx) = mpsc::channel::<Result<(), String>>();
            let cmd = AudioCommand::SetVolume(vol, tx);

            match cmd {
                AudioCommand::SetVolume(v, sender) => {
                    assert_eq!(v, vol);
                    let _ = sender.send(Ok(()));
                }
                _ => panic!("Wrong command variant"),
            }

            assert!(rx.recv().unwrap().is_ok());
        }
    }

    // ==================== PlayCountState and ScrobbleState Tests ====================

    #[test]
    fn test_play_count_state_initial() {
        let state = PlayCountState {
            track_id: None,
            threshold_reached: false,
        };

        assert!(state.track_id.is_none());
        assert!(!state.threshold_reached);
    }

    #[test]
    fn test_play_count_state_with_track() {
        let state = PlayCountState {
            track_id: Some(123),
            threshold_reached: false,
        };

        assert_eq!(state.track_id, Some(123));
        assert!(!state.threshold_reached);
    }

    #[test]
    fn test_play_count_state_threshold_reached() {
        let state = PlayCountState {
            track_id: Some(456),
            threshold_reached: true,
        };

        assert!(state.threshold_reached);
    }

    #[test]
    fn test_scrobble_state_initial() {
        let state = ScrobbleState {
            track_id: None,
            threshold_reached: false,
            threshold_percent: 0.9,
        };

        assert!(state.track_id.is_none());
        assert!(!state.threshold_reached);
        assert_eq!(state.threshold_percent, 0.9);
    }

    #[test]
    fn test_scrobble_state_custom_threshold() {
        let state = ScrobbleState {
            track_id: Some(789),
            threshold_reached: false,
            threshold_percent: 0.5, // 50% threshold
        };

        assert_eq!(state.threshold_percent, 0.5);
    }

    #[test]
    fn test_scrobble_threshold_calculation() {
        let position_ms: u64 = 162000; // 2.7 minutes
        let duration_ms: u64 = 180000; // 3 minutes
        let threshold_percent = 0.9;

        let ratio = position_ms as f64 / duration_ms as f64;
        assert!(ratio >= threshold_percent);
    }

    #[test]
    fn test_play_count_threshold_calculation() {
        let position_ms: u64 = 135000; // 2.25 minutes
        let duration_ms: u64 = 180000; // 3 minutes
        let threshold = 0.75;

        let ratio = position_ms as f64 / duration_ms as f64;
        assert!(ratio >= threshold);
    }

    // ==================== Device Command Tests ====================

    #[test]
    fn test_audio_command_set_device_with_resolved_device() {
        use rodio::cpal::traits::HostTrait;

        let host = rodio::cpal::default_host();
        let device = match host.default_output_device() {
            Some(d) => d,
            None => return, // No audio hardware on CI
        };

        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        let cmd = AudioCommand::SetDevice(device, tx);

        match cmd {
            AudioCommand::SetDevice(_device, sender) => {
                let _ = sender.send(Ok(()));
            }
            _ => panic!("Wrong command variant"),
        }

        assert!(rx.recv().unwrap().is_ok());
    }

    // ==================== DeviceListResponse Tests ====================

    #[test]
    fn test_device_list_response_serialization() {
        let response = DeviceListResponse {
            devices: vec!["Built-in Output".to_string(), "External DAC".to_string()],
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"devices\""));
        assert!(json.contains("Built-in Output"));
        assert!(json.contains("External DAC"));
    }

    #[test]
    fn test_device_list_response_deserialization() {
        let json = r#"{"devices":["Speaker","Headphones"]}"#;
        let response: DeviceListResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.devices.len(), 2);
        assert_eq!(response.devices[0], "Speaker");
        assert_eq!(response.devices[1], "Headphones");
    }

    #[test]
    fn test_device_list_response_empty() {
        let response = DeviceListResponse { devices: vec![] };
        let json = serde_json::to_string(&response).unwrap();
        assert_eq!(json, r#"{"devices":[]}"#);
    }

    #[test]
    fn test_device_list_response_clone() {
        let response = DeviceListResponse {
            devices: vec!["Test Device".to_string()],
        };
        let cloned = response.clone();
        assert_eq!(response.devices, cloned.devices);
    }

    // ==================== StallDetector Tests (task-332) ====================

    #[test]
    fn test_stall_detector_no_stall_when_position_advances() {
        let mut d = StallDetector::new();
        // Position advancing near end — should not trigger
        for pos in 295_000..296_000 {
            assert!(!d.check(pos, 300_000));
        }
    }

    #[test]
    fn test_stall_detector_triggers_after_threshold() {
        let mut d = StallDetector::new();
        let pos = 298_000; // within END_PROXIMITY_MS of 300_000
        let dur = 300_000;

        // First call records the position
        assert!(!d.check(pos, dur));
        // Subsequent calls with same position increment counter
        for _ in 1..StallDetector::THRESHOLD {
            assert!(!d.check(pos, dur));
        }
        // At threshold, triggers
        assert!(d.check(pos, dur));
    }

    #[test]
    fn test_stall_detector_resets_on_position_change() {
        let mut d = StallDetector::new();
        let dur = 300_000;

        // Build up 9 stall counts at position 298_000
        for _ in 0..StallDetector::THRESHOLD - 1 {
            d.check(298_000, dur);
        }
        // Position advances — counter resets
        assert!(!d.check(298_001, dur));
        // Need full threshold again
        for _ in 1..StallDetector::THRESHOLD {
            assert!(!d.check(298_001, dur));
        }
        assert!(d.check(298_001, dur));
    }

    #[test]
    fn test_stall_detector_ignores_position_far_from_end() {
        let mut d = StallDetector::new();
        let dur = 300_000;
        // Position is not within END_PROXIMITY_MS of end
        let pos = 100_000;

        for _ in 0..StallDetector::THRESHOLD + 5 {
            assert!(!d.check(pos, dur));
        }
    }

    #[test]
    fn test_stall_detector_ignores_zero_duration() {
        let mut d = StallDetector::new();
        for _ in 0..StallDetector::THRESHOLD + 5 {
            assert!(!d.check(50_000, 0));
        }
    }

    #[test]
    fn test_stall_detector_ignores_zero_position() {
        let mut d = StallDetector::new();
        for _ in 0..StallDetector::THRESHOLD + 5 {
            assert!(!d.check(0, 300_000));
        }
    }

    #[test]
    fn test_stall_detector_reset_clears_state() {
        let mut d = StallDetector::new();
        let dur = 300_000;

        // Build up stall count
        for _ in 0..StallDetector::THRESHOLD - 1 {
            d.check(298_000, dur);
        }
        // Reset
        d.reset();
        // First call after reset records the position (position_ms was 0)
        assert!(!d.check(298_000, dur));
        // Then need THRESHOLD - 1 more same-position calls before it triggers
        for _ in 1..StallDetector::THRESHOLD {
            assert!(!d.check(298_000, dur));
        }
        // At THRESHOLD, triggers
        assert!(d.check(298_000, dur));
    }

    #[test]
    fn test_stall_detector_end_proximity_boundary() {
        let mut d = StallDetector::new();
        let dur = 300_000;

        // Exactly at the boundary: pos + END_PROXIMITY_MS == dur
        let boundary_pos = dur - StallDetector::END_PROXIMITY_MS;
        // First call records position
        d.check(boundary_pos, dur);
        for _ in 1..StallDetector::THRESHOLD {
            assert!(!d.check(boundary_pos, dur));
        }
        // Should trigger at boundary
        assert!(d.check(boundary_pos, dur));
    }

    #[test]
    fn test_stall_detector_just_outside_proximity() {
        let mut d = StallDetector::new();
        let dur = 300_000;

        // One ms before the proximity window
        let pos = dur - StallDetector::END_PROXIMITY_MS - 1;
        for _ in 0..StallDetector::THRESHOLD + 5 {
            assert!(!d.check(pos, dur));
        }
    }
}
