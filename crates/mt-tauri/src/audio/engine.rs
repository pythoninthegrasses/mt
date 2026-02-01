use crate::audio::error::AudioError;
use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink, Source};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::time::Duration;

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
    stream: OutputStream,
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
            stream,
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
            return Err(AudioError::FileOpen(format!("File not found: {}", path)));
        }

        let file = File::open(path)?;
        let reader = BufReader::new(file);
        let source = Decoder::new(reader)
            .map_err(|e| AudioError::Decode(e.to_string()))?;

        let sample_rate = source.sample_rate();
        let channels = source.channels();
        let duration = source.total_duration().unwrap_or(Duration::ZERO);
        let duration_ms = duration.as_millis() as u64;

        let sink = Sink::connect_new(self.stream.mixer());
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

        Ok(track_info)
    }

    pub fn play(&mut self) -> Result<(), AudioError> {
        if let Some(ref handle) = self.player_handle {
            handle.sink.play();
            self.state = PlaybackState::Playing;
            Ok(())
        } else {
            Err(AudioError::NoTrack)
        }
    }

    pub fn pause(&mut self) -> Result<(), AudioError> {
        if let Some(ref handle) = self.player_handle {
            handle.sink.pause();
            self.state = PlaybackState::Paused;
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
    }

    pub fn seek(&mut self, position_ms: u64) -> Result<(), AudioError> {
        let current_pos = self.player_handle
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
            handle.sink.try_seek(duration)
                .map_err(|e| AudioError::Seek(format!("{:?}", e)))?;
            Ok(())
        } else {
            Err(AudioError::NoTrack)
        }
    }
    
    fn seek_by_reload(&mut self, position_ms: u64) -> Result<(), AudioError> {
        let track_info = self.current_track.clone().ok_or(AudioError::NoTrack)?;
        let was_playing = self.state == PlaybackState::Playing;
        
        let file = File::open(&track_info.path)?;
        let reader = BufReader::new(file);
        let source = Decoder::new(reader)
            .map_err(|e| AudioError::Decode(e.to_string()))?;
        
        if let Some(handle) = self.player_handle.take() {
            handle.sink.stop();
        }
        
        let sink = Sink::connect_new(self.stream.mixer());
        sink.set_volume(self.volume);
        sink.append(source);
        
        let duration = Duration::from_millis(position_ms);
        sink.try_seek(duration)
            .map_err(|e| AudioError::Seek(format!("{:?}", e)))?;
        
        if was_playing {
            sink.play();
            self.state = PlaybackState::Playing;
        } else {
            sink.pause();
            self.state = PlaybackState::Paused;
        }
        
        self.player_handle = Some(PlayerHandle { sink });
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
            let dur = self.current_track.as_ref().map(|t| t.duration_ms).unwrap_or(0);
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
}

impl Default for AudioEngine {
    fn default() -> Self {
        Self::new().expect("Failed to create audio engine")
    }
}
