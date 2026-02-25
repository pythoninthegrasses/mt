mod audio_error;
mod engine;

pub use audio_error::AudioError;
pub use engine::{AudioEngine, PlaybackState, Progress, TrackInfo};

#[cfg(test)]
#[path = "engine_test.rs"]
mod engine_test;
