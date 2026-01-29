mod engine;
mod error;

pub use engine::{AudioEngine, PlaybackState, Progress, TrackInfo};
pub use error::AudioError;

#[cfg(test)]
#[path = "engine_test.rs"]
mod engine_test;
