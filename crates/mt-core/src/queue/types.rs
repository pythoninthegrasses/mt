//! The shapes the queue commands hand back to the frontend.
//!
//! Field names and JSON shapes are the IPC contract: they are unchanged from
//! the desktop commands these came out of. `action` and `loop_mode` stay
//! strings rather than enums because that is what the frontend compares
//! against.

use serde::{Deserialize, Serialize};

use crate::db::{QueueItem, QueueState, Track};

/// Response for queue get operations
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueueResponse {
    pub items: Vec<QueueItem>,
    pub count: i64,
}

/// Response for queue add operations
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueueAddResponse {
    pub added: i64,
    pub queue_length: i64,
}

/// Response for queue add-files operations
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueueAddFilesResponse {
    pub added: i64,
    pub queue_length: i64,
    pub tracks: Vec<Track>,
}

/// Response for queue operations that return success status
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueueOperationResponse {
    pub success: bool,
    pub queue_length: i64,
}

/// Full queue state snapshot returned by state-changing commands
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueueStateSnapshot {
    pub items: Vec<QueueItem>,
    pub current_index: i64,
    pub shuffle_enabled: bool,
    pub loop_mode: String,
    pub play_next_offset: i64,
}

impl QueueStateSnapshot {
    /// Snapshot of a queue the caller already read, paired with its state.
    pub fn new(items: Vec<QueueItem>, state: &QueueState) -> Self {
        Self {
            items,
            current_index: state.current_index,
            shuffle_enabled: state.shuffle_enabled,
            loop_mode: state.loop_mode.clone(),
            play_next_offset: state.play_next_offset,
        }
    }

    /// Queue length, which is what the `queue-updated` payload announces.
    pub fn len(&self) -> i64 {
        self.items.len() as i64
    }

    /// Whether the queue is empty; required alongside [`Self::len`].
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

/// Result of a navigation command (play next/previous/skip)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueueNavigationResult {
    /// "play", "stop", or "seek_zero"
    pub action: String,
    pub track: Option<Track>,
    pub duration_ms: Option<u64>,
    pub snapshot: QueueStateSnapshot,
}

/// Response for atomic play-context operations
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlayContextResponse {
    pub items: Vec<QueueItem>,
    pub current_index: i64,
    pub track: Track,
    pub shuffle_enabled: bool,
    /// Duration in milliseconds from the audio engine (more accurate than DB metadata)
    pub duration_ms: u64,
}

#[cfg(test)]
#[path = "types_tests.rs"]
mod tests;
