use crate::audio::audio_error::AudioError;
use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink, Source};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;
use std::time::Duration;
use tracing::{debug, error, info, warn};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlaybackState {
    Stopped,
    Playing,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackInfo {
    pub path: String,
    pub duration_ms: u64,
    pub sample_rate: u32,
    pub channels: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Progress {
    pub position_ms: u64,
    pub duration_ms: u64,
    pub state: PlaybackState,
}

struct PlayerHandle {
    sink: Sink,
}

pub struct AudioEngine {
    stream: Option<OutputStream>,
    player_handle: Option<PlayerHandle>,
    state: PlaybackState,
    volume: f32,
    current_track: Option<TrackInfo>,
}

impl AudioEngine {
    pub fn new() -> Result<Self, AudioError> {
        let stream = OutputStreamBuilder::open_default_stream()
            .map_err(|e| AudioError::Stream(e.to_string()))?;
        Ok(Self {
            stream: Some(stream),
            player_handle: None,
            state: PlaybackState::Stopped,
            volume: 1.0,
            current_track: None,
        })
    }

    pub fn load(&mut self, path: &str) -> Result<TrackInfo, AudioError> {
        self.stop();

        let path_obj = Path::new(path);
        if !path_obj.exists() {
            error!(path, "Track file not found");
            return Err(AudioError::FileOpen(format!("File not found: {}", path)));
        }

        let file = File::open(path)?;
        let source = Decoder::try_from(file).map_err(|e| {
            error!(path, error = %e, "Failed to decode track");
            AudioError::Decode(e.to_string())
        })?;

        let sample_rate = source.sample_rate();
        let channels = source.channels();
        let duration = source.total_duration().unwrap_or(Duration::ZERO);
        let duration_ms = duration.as_millis() as u64;

        let stream = self
            .stream
            .as_ref()
            .ok_or_else(|| AudioError::Stream("No active audio stream".to_string()))?;
        let sink = Sink::connect_new(stream.mixer());
        sink.set_volume(self.volume);
        sink.append(source);
        sink.pause();

        let track_info = TrackInfo {
            path: path.to_string(),
            duration_ms,
            sample_rate,
            channels,
        };

        self.player_handle = Some(PlayerHandle { sink });
        self.current_track = Some(track_info.clone());
        self.state = PlaybackState::Paused;

        info!(path, duration_ms, sample_rate, channels, "Track loaded");

        Ok(track_info)
    }

    pub fn play(&mut self) -> Result<(), AudioError> {
        if let Some(ref handle) = self.player_handle {
            handle.sink.play();
            self.state = PlaybackState::Playing;
            debug!("Playback started");
            Ok(())
        } else {
            Err(AudioError::NoTrack)
        }
    }

    pub fn pause(&mut self) -> Result<(), AudioError> {
        if let Some(ref handle) = self.player_handle {
            handle.sink.pause();
            self.state = PlaybackState::Paused;
            debug!("Playback paused");
            Ok(())
        } else {
            Err(AudioError::NoTrack)
        }
    }

    pub fn stop(&mut self) {
        if let Some(handle) = self.player_handle.take() {
            handle.sink.stop();
        }
        self.state = PlaybackState::Stopped;
        self.current_track = None;
        debug!("Playback stopped");
    }

    pub fn seek(&mut self, position_ms: u64) -> Result<(), AudioError> {
        let current_pos = self
            .player_handle
            .as_ref()
            .map(|h| h.sink.get_pos().as_millis() as u64)
            .unwrap_or(0);

        let is_backward = position_ms < current_pos;

        if is_backward {
            self.seek_by_reload(position_ms)
        } else {
            self.seek_forward(position_ms)
        }
    }

    fn seek_forward(&mut self, position_ms: u64) -> Result<(), AudioError> {
        if let Some(ref handle) = self.player_handle {
            let duration = Duration::from_millis(position_ms);
            handle.sink.try_seek(duration).map_err(|e| {
                error!(position_ms, error = ?e, "Seek forward failed");
                AudioError::Seek(format!("{:?}", e))
            })?;
            debug!(position_ms, "Seeked forward");
            Ok(())
        } else {
            Err(AudioError::NoTrack)
        }
    }

    fn seek_by_reload(&mut self, position_ms: u64) -> Result<(), AudioError> {
        let track_info = self.current_track.clone().ok_or(AudioError::NoTrack)?;
        let was_playing = self.state == PlaybackState::Playing;

        let file = File::open(&track_info.path)?;
        let source = Decoder::try_from(file).map_err(|e| {
            error!(path = %track_info.path, error = %e, "Decode failed during seek-by-reload");
            AudioError::Decode(e.to_string())
        })?;

        if let Some(handle) = self.player_handle.take() {
            handle.sink.stop();
        }

        let stream = self
            .stream
            .as_ref()
            .ok_or_else(|| AudioError::Stream("No active audio stream".to_string()))?;
        let sink = Sink::connect_new(stream.mixer());
        sink.set_volume(self.volume);
        sink.append(source);

        let duration = Duration::from_millis(position_ms);
        sink.try_seek(duration).map_err(|e| {
            error!(position_ms, error = ?e, "Seek-by-reload seek failed");
            AudioError::Seek(format!("{:?}", e))
        })?;

        if was_playing {
            sink.play();
            self.state = PlaybackState::Playing;
        } else {
            sink.pause();
            self.state = PlaybackState::Paused;
        }

        self.player_handle = Some(PlayerHandle { sink });
        debug!(position_ms, "Seeked backward (via reload)");
        Ok(())
    }

    pub fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);
        if let Some(ref handle) = self.player_handle {
            handle.sink.set_volume(self.volume);
        }
    }

    pub fn get_volume(&self) -> f32 {
        self.volume
    }

    pub fn get_progress(&self) -> Progress {
        let (position_ms, duration_ms) = if let Some(ref handle) = self.player_handle {
            let pos = handle.sink.get_pos();
            let dur = self
                .current_track
                .as_ref()
                .map(|t| t.duration_ms)
                .unwrap_or(0);
            (pos.as_millis() as u64, dur)
        } else {
            (0, 0)
        };

        let state = if self.is_finished() {
            PlaybackState::Stopped
        } else {
            self.state
        };

        Progress {
            position_ms,
            duration_ms,
            state,
        }
    }

    pub fn get_state(&self) -> PlaybackState {
        if self.is_finished() {
            PlaybackState::Stopped
        } else {
            self.state
        }
    }

    pub fn get_current_track(&self) -> Option<&TrackInfo> {
        self.current_track.as_ref()
    }

    pub fn is_finished(&self) -> bool {
        if let Some(ref handle) = self.player_handle {
            // Track is finished when sink is empty (all sources consumed)
            // and we were previously playing
            handle.sink.empty() && self.state == PlaybackState::Playing
        } else {
            false
        }
    }

    /// Switch audio output to a named device, or default if `name` is None.
    ///
    /// Preserves current playback position and state. If the named device is
    /// not found, falls back to the system default and returns an error.
    pub fn set_device(&mut self, name: Option<&str>) -> Result<(), AudioError> {
        // Resolve the target device before tearing anything down. For named
        // devices we need to enumerate first; for default we grab the host's
        // default. Validation happens here so we can bail early without
        // disrupting playback.
        let device = match name {
            Some(device_name) => {
                let host = rodio::cpal::default_host();
                let devices = host.output_devices().map_err(|e| {
                    AudioError::Device(format!("Failed to enumerate devices: {}", e))
                })?;

                let found = devices
                    .into_iter()
                    .find(|d| d.name().ok().as_deref() == Some(device_name));

                match found {
                    Some(d) => {
                        info!(device = device_name, "Switching audio output device");
                        d
                    }
                    None => {
                        warn!(
                            device = device_name,
                            "Device not found, falling back to default"
                        );
                        return Err(AudioError::Device(format!(
                            "Device not found: {}",
                            device_name
                        )));
                    }
                }
            }
            None => {
                let host = rodio::cpal::default_host();
                host.default_output_device().ok_or_else(|| {
                    AudioError::Device("No default output device found".to_string())
                })?
            }
        };

        // Capture current playback state before switching
        let was_playing = self.state == PlaybackState::Playing;
        let position_ms = self
            .player_handle
            .as_ref()
            .map(|h| h.sink.get_pos().as_millis() as u64)
            .unwrap_or(0);
        let track_info = self.current_track.clone();

        // Stop current playback (sink must be dropped before the stream)
        if let Some(handle) = self.player_handle.take() {
            handle.sink.stop();
        }

        // Drop old stream BEFORE creating the new one. On macOS CoreAudio,
        // two simultaneous streams to the same physical device (e.g. switching
        // from "Mac Studio Speakers" to "Default" which resolves to the same
        // hardware) causes the new stream to produce silence.
        self.stream = None;

        if name.is_none() {
            info!("Switching to default audio output device");
        }

        let new_stream = OutputStreamBuilder::from_device(device)
            .map_err(|e| AudioError::Device(e.to_string()))?
            .open_stream()
            .map_err(|e| AudioError::Device(e.to_string()))?;

        self.stream = Some(new_stream);

        // Reload track on new stream if one was loaded
        if let Some(ref track) = track_info {
            let path_obj = Path::new(&track.path);
            if path_obj.exists()
                && let Ok(file) = File::open(&track.path)
                && let Ok(source) = Decoder::try_from(file)
            {
                let mixer = self.stream.as_ref().expect("stream just assigned").mixer();
                let sink = Sink::connect_new(mixer);
                sink.set_volume(self.volume);
                sink.append(source);

                // Seek to previous position
                if position_ms > 0 {
                    let _ = sink.try_seek(Duration::from_millis(position_ms));
                }

                if was_playing {
                    sink.play();
                    self.state = PlaybackState::Playing;
                } else {
                    sink.pause();
                    self.state = PlaybackState::Paused;
                }

                self.player_handle = Some(PlayerHandle { sink });
                debug!(
                    path = %track.path,
                    position_ms,
                    "Track reloaded on new device"
                );
            }
        }

        Ok(())
    }
}

/// Enumerate available audio output device names.
///
/// Returns a list of device names. Does not include "Default" — the caller
/// should prepend that as a UI label.
pub fn list_output_devices() -> Result<Vec<String>, AudioError> {
    let host = rodio::cpal::default_host();
    let devices = host
        .output_devices()
        .map_err(|e| AudioError::Device(format!("Failed to enumerate output devices: {}", e)))?;

    let names: Vec<String> = devices.filter_map(|d| d.name().ok()).collect();

    debug!(count = names.len(), "Enumerated output devices");
    Ok(names)
}

#[cfg(test)]
impl AudioEngine {
    /// Remove the active stream to simulate a transient no-stream state.
    /// Only available in tests.
    pub(crate) fn drop_stream(&mut self) {
        self.stream = None;
    }
}

impl Default for AudioEngine {
    fn default() -> Self {
        Self::new().expect("Failed to create audio engine")
    }
}
