use crate::audio::{AudioEngine, PlaybackState, TrackInfo};
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackStatus {
    pub position_ms: u64,
    pub duration_ms: u64,
    pub state: PlaybackState,
    pub volume: f32,
    pub track: Option<TrackInfo>,
}

enum AudioCommand {
    Load(String, Option<i64>, Sender<Result<TrackInfo, String>>),  // Add track_id
    Play(Sender<Result<(), String>>),
    Pause(Sender<Result<(), String>>),
    Stop(Sender<Result<(), String>>),
    Seek(u64, Sender<Result<(), String>>),
    SetVolume(f32, Sender<Result<(), String>>),
    GetVolume(Sender<f32>),
    GetStatus(Sender<PlaybackStatus>),
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
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<AudioCommand>();

        thread::spawn(move || {
            audio_thread(rx, app);
        });

        Self { sender: tx }
    }

    fn send_command(&self, cmd: AudioCommand) {
        let _ = self.sender.send(cmd);
    }
}

fn audio_thread(rx: Receiver<AudioCommand>, app: AppHandle) {
    let mut engine = match AudioEngine::new() {
        Ok(e) => e,
        Err(e) => {
            eprintln!("Failed to create audio engine: {}", e);
            return;
        }
    };

    let mut last_finished = false;
    let mut last_emit = std::time::Instant::now();
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
                    let result = engine.load(&path).map_err(|e| e.to_string());

                    // Reset play count state for new track
                    play_count_state.track_id = track_id;
                    play_count_state.threshold_reached = false;

                    // Reset scrobble state for new track
                    scrobble_state.track_id = track_id;
                    scrobble_state.threshold_reached = false;

                    last_finished = false;

                    let _ = reply.send(result);
                }
                AudioCommand::Play(reply) => {
                    let result = engine.play().map_err(|e| e.to_string());
                    let _ = reply.send(result);
                }
                AudioCommand::Pause(reply) => {
                    let result = engine.pause().map_err(|e| e.to_string());
                    let _ = reply.send(result);
                }
                AudioCommand::Stop(reply) => {
                    engine.stop();
                    let _ = reply.send(Ok(()));
                }
                AudioCommand::Seek(pos, reply) => {
                    let result = engine.seek(pos).map_err(|e| e.to_string());
                    let _ = reply.send(result);
                }
                AudioCommand::SetVolume(vol, reply) => {
                    engine.set_volume(vol);
                    let _ = reply.send(Ok(()));
                }
                AudioCommand::GetVolume(reply) => {
                    let _ = reply.send(engine.get_volume());
                }
                AudioCommand::GetStatus(reply) => {
                    let progress = engine.get_progress();
                    let track = engine.get_current_track().cloned();
                    let status = PlaybackStatus {
                        position_ms: progress.position_ms,
                        duration_ms: progress.duration_ms,
                        state: progress.state,
                        volume: engine.get_volume(),
                        track,
                    };
                    let _ = reply.send(status);
                }
            },
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        let is_playing = engine.get_state() == PlaybackState::Playing;
        let is_finished = engine.is_finished();

        if is_playing && last_emit.elapsed() >= Duration::from_millis(250) {
            let progress = engine.get_progress();
            let _ = app.emit("audio://progress", &progress);
            last_emit = std::time::Instant::now();

            // Check play count threshold (75%)
            if !play_count_state.threshold_reached
               && progress.duration_ms > 0
               && play_count_state.track_id.is_some() {
                let ratio = progress.position_ms as f64 / progress.duration_ms as f64;

                if ratio >= 0.75
                    && let Some(track_id) = play_count_state.track_id {
                        // Spawn async task to avoid blocking audio thread
                        let app_handle = app.clone();
                        std::thread::spawn(move || {
                            use crate::db::Database;
                            use crate::db::library;

                            let db = app_handle.state::<Database>();
                            if let Ok(conn) = db.conn() {
                                let _ = library::update_play_count(&conn, track_id);
                                println!("[audio] Play count updated for track_id={}", track_id);
                            }
                        });
                        play_count_state.threshold_reached = true;
                    }
            }

            // Check scrobble threshold (90% default, configurable)
            if !scrobble_state.threshold_reached
               && progress.duration_ms > 0
               && scrobble_state.track_id.is_some() {
                let ratio = progress.position_ms as f64 / progress.duration_ms as f64;

                if ratio >= scrobble_state.threshold_percent
                    && let Some(track_id) = scrobble_state.track_id {
                        // Spawn async task to avoid blocking audio thread
                        let app_handle = app.clone();
                        std::thread::spawn(move || {
                            use crate::commands::lastfm;
                            use crate::db::Database;

                            let db = app_handle.state::<Database>();
                            if let Ok(conn) = db.conn() {
                                // Queue scrobble from audio thread
                                match lastfm::scrobble_from_audio_thread(&app_handle, &conn, track_id) {
                                    Ok(_) => println!("[audio] Scrobble queued for track_id={}", track_id),
                                    Err(e) => eprintln!("[audio] Failed to queue scrobble: {}", e),
                                }
                            }
                        });
                        scrobble_state.threshold_reached = true;
                    }
            }
        }

        if is_finished && !last_finished {
            let _ = app.emit("audio://track-ended", ());
        }
        last_finished = is_finished;
    }
}

#[tauri::command]
pub fn audio_load(path: String, track_id: Option<i64>, state: State<AudioState>) -> Result<TrackInfo, String> {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::Load(path, track_id, tx));
    rx.recv().map_err(|_| "Channel closed".to_string())?
}

#[tauri::command]
pub fn audio_play(state: State<AudioState>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::Play(tx));
    rx.recv().map_err(|_| "Channel closed".to_string())?
}

#[tauri::command]
pub fn audio_pause(state: State<AudioState>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::Pause(tx));
    rx.recv().map_err(|_| "Channel closed".to_string())?
}

#[tauri::command]
pub fn audio_stop(state: State<AudioState>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::Stop(tx));
    rx.recv().map_err(|_| "Channel closed".to_string())?
}

#[tauri::command]
pub fn audio_seek(position_ms: u64, state: State<AudioState>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::Seek(position_ms, tx));
    rx.recv().map_err(|_| "Channel closed".to_string())?
}

#[tauri::command]
pub fn audio_set_volume(volume: f32, state: State<AudioState>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::SetVolume(volume, tx));
    rx.recv().map_err(|_| "Channel closed".to_string())?
}

#[tauri::command]
pub fn audio_get_volume(state: State<AudioState>) -> f32 {
    let (tx, rx) = mpsc::channel();
    state.send_command(AudioCommand::GetVolume(tx));
    rx.recv().unwrap_or(1.0)
}

#[tauri::command]
pub fn audio_get_status(state: State<AudioState>) -> PlaybackStatus {
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
}
