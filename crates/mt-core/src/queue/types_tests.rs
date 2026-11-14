//! Tests for the queue response shapes.
//!
//! These came across with the code from `mt-tauri`, where they were the only
//! tests in `commands/queue.rs`. They stay because the shapes are the IPC
//! contract: the field names asserted here are the ones the frontend reads.

use super::*;
use crate::db::Track;

fn track(id: i64, filepath: &str) -> Track {
    Track {
        id,
        filepath: filepath.to_string(),
        title: Some("Track 1".to_string()),
        source: "local".to_string(),
        ..Default::default()
    }
}

// ==================== QueueResponse Tests ====================

#[test]
fn test_queue_response_serialization() {
    let response = QueueResponse {
        items: vec![],
        count: 0,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"count\":0"));
    assert!(json.contains("\"items\":[]"));
}

#[test]
fn test_queue_response_empty() {
    let response = QueueResponse {
        items: vec![],
        count: 0,
    };

    assert!(response.items.is_empty());
    assert_eq!(response.count, 0);
}

#[test]
fn test_queue_response_clone() {
    let response = QueueResponse {
        items: vec![],
        count: 5,
    };

    let cloned = response.clone();
    assert_eq!(response.count, cloned.count);
}

#[test]
fn test_queue_response_count_matches_items() {
    let response = QueueResponse {
        items: vec![],
        count: 0,
    };

    assert_eq!(response.items.len() as i64, response.count);
}

// ==================== QueueAddResponse Tests ====================

#[test]
fn test_queue_add_response_serialization() {
    let response = QueueAddResponse {
        added: 3,
        queue_length: 10,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"added\":3"));
    assert!(json.contains("\"queue_length\":10"));
}

#[test]
fn test_queue_add_response_zero_added() {
    let response = QueueAddResponse {
        added: 0,
        queue_length: 5,
    };

    assert_eq!(response.added, 0);
    assert_eq!(response.queue_length, 5);
}

#[test]
fn test_queue_add_response_clone() {
    let response = QueueAddResponse {
        added: 10,
        queue_length: 100,
    };

    let cloned = response.clone();
    assert_eq!(response.added, cloned.added);
    assert_eq!(response.queue_length, cloned.queue_length);
}

#[test]
fn test_queue_add_response_large_values() {
    let response = QueueAddResponse {
        added: 10000,
        queue_length: 100000,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"added\":10000"));
    assert!(json.contains("\"queue_length\":100000"));
}

// ==================== QueueAddFilesResponse Tests ====================

#[test]
fn test_queue_add_files_response_serialization() {
    let response = QueueAddFilesResponse {
        added: 5,
        queue_length: 15,
        tracks: vec![],
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"added\":5"));
    assert!(json.contains("\"queue_length\":15"));
    assert!(json.contains("\"tracks\":[]"));
}

#[test]
fn test_queue_add_files_response_empty_tracks() {
    let response = QueueAddFilesResponse {
        added: 0,
        queue_length: 0,
        tracks: vec![],
    };

    assert!(response.tracks.is_empty());
    assert_eq!(response.added, 0);
}

#[test]
fn test_queue_add_files_response_clone() {
    let response = QueueAddFilesResponse {
        added: 3,
        queue_length: 10,
        tracks: vec![],
    };

    let cloned = response.clone();
    assert_eq!(response.added, cloned.added);
    assert_eq!(response.tracks.len(), cloned.tracks.len());
}

// ==================== QueueOperationResponse Tests ====================

#[test]
fn test_queue_operation_response_success() {
    let response = QueueOperationResponse {
        success: true,
        queue_length: 10,
    };

    assert!(response.success);
    assert_eq!(response.queue_length, 10);
}

#[test]
fn test_queue_operation_response_failure() {
    let response = QueueOperationResponse {
        success: false,
        queue_length: 5,
    };

    assert!(!response.success);
}

#[test]
fn test_queue_operation_response_serialization() {
    let response = QueueOperationResponse {
        success: true,
        queue_length: 25,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"success\":true"));
    assert!(json.contains("\"queue_length\":25"));
}

#[test]
fn test_queue_operation_response_clone() {
    let response = QueueOperationResponse {
        success: true,
        queue_length: 42,
    };

    let cloned = response.clone();
    assert_eq!(response.success, cloned.success);
    assert_eq!(response.queue_length, cloned.queue_length);
}

// ==================== Edge Cases ====================

#[test]
fn test_queue_response_deserialization() {
    let json = r#"{"items":[],"count":0}"#;
    let response: QueueResponse = serde_json::from_str(json).unwrap();
    assert_eq!(response.count, 0);
    assert!(response.items.is_empty());
}

#[test]
fn test_queue_add_response_deserialization() {
    let json = r#"{"added":5,"queue_length":20}"#;
    let response: QueueAddResponse = serde_json::from_str(json).unwrap();
    assert_eq!(response.added, 5);
    assert_eq!(response.queue_length, 20);
}

#[test]
fn test_queue_operation_response_deserialization() {
    let json = r#"{"success":false,"queue_length":0}"#;
    let response: QueueOperationResponse = serde_json::from_str(json).unwrap();
    assert!(!response.success);
    assert_eq!(response.queue_length, 0);
}

#[test]
fn test_queue_add_response_added_greater_than_length() {
    // Edge case: added could theoretically be >= queue_length in some scenarios
    let response = QueueAddResponse {
        added: 10,
        queue_length: 10, // Queue was empty, now has 10
    };

    assert_eq!(response.added, response.queue_length);
}

#[test]
fn test_queue_response_max_count() {
    let response = QueueResponse {
        items: vec![],
        count: i64::MAX,
    };

    let json = serde_json::to_string(&response).unwrap();
    let deserialized: QueueResponse = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.count, i64::MAX);
}

// ==================== Boundary Conditions ====================

#[test]
fn test_queue_operation_response_zero_length() {
    let response = QueueOperationResponse {
        success: true,
        queue_length: 0,
    };

    assert_eq!(response.queue_length, 0);
}

#[test]
fn test_queue_add_files_consistency() {
    // The added count should logically match tracks.len() after a successful add
    let response = QueueAddFilesResponse {
        added: 3,
        queue_length: 10,
        tracks: vec![], // Note: in real usage, tracks would have 3 items
    };

    // This test verifies the response structure can hold mismatched values
    // (validation should happen at the command level, not response level)
    assert_eq!(response.added, 3);
}

// ==================== PlayContextResponse Tests ====================

#[test]
fn test_play_context_response_serialization() {
    let response = PlayContextResponse {
        items: vec![],
        current_index: 0,
        track: track(1, "/music/track1.mp3"),
        shuffle_enabled: true,
        duration_ms: 180000,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"current_index\":0"));
    assert!(json.contains("\"shuffle_enabled\":true"));
    assert!(json.contains("track1.mp3"));
}

#[test]
fn test_play_context_response_deserialization() {
    let json = r#"{"items":[],"current_index":5,"track":{"id":1,"filepath":"/a.mp3","play_count":0,"missing":false,"file_size":0},"shuffle_enabled":false,"duration_ms":240000}"#;
    let response: PlayContextResponse = serde_json::from_str(json).unwrap();
    assert_eq!(response.current_index, 5);
    assert!(!response.shuffle_enabled);
    assert_eq!(response.track.filepath, "/a.mp3");
}

#[test]
fn test_play_context_response_clone() {
    let response = PlayContextResponse {
        items: vec![],
        current_index: 0,
        track: track(1, "/music/track1.mp3"),
        shuffle_enabled: false,
        duration_ms: 0,
    };

    let cloned = response.clone();
    assert_eq!(response.current_index, cloned.current_index);
    assert_eq!(response.shuffle_enabled, cloned.shuffle_enabled);
    assert_eq!(response.track.id, cloned.track.id);
}

// ==================== QueueStateSnapshot Tests ====================

#[test]
fn test_snapshot_takes_the_state_machine_from_the_state() {
    let state = QueueState {
        current_index: 3,
        shuffle_enabled: true,
        loop_mode: "all".to_string(),
        original_order_json: None,
        play_next_offset: 2,
        play_history_json: None,
        play_next_track_ids_json: None,
        repeat_one_pending: false,
    };

    let snapshot = QueueStateSnapshot::new(vec![], &state);

    assert_eq!(snapshot.current_index, 3);
    assert!(snapshot.shuffle_enabled);
    assert_eq!(snapshot.loop_mode, "all");
    assert_eq!(snapshot.play_next_offset, 2);
}

#[test]
fn test_snapshot_len_counts_rows() {
    let state = QueueState {
        current_index: 0,
        shuffle_enabled: false,
        loop_mode: "none".to_string(),
        original_order_json: None,
        play_next_offset: 0,
        play_history_json: None,
        play_next_track_ids_json: None,
        repeat_one_pending: false,
    };
    let items = vec![
        QueueItem {
            position: 0,
            track: track(1, "/music/track1.mp3"),
        },
        QueueItem {
            position: 1,
            track: track(2, "/music/track2.mp3"),
        },
    ];

    let snapshot = QueueStateSnapshot::new(items, &state);

    assert_eq!(snapshot.len(), 2);
    assert!(!snapshot.is_empty());
}

#[test]
fn test_navigation_result_serialization() {
    let state = QueueState {
        current_index: 0,
        shuffle_enabled: false,
        loop_mode: "none".to_string(),
        original_order_json: None,
        play_next_offset: 0,
        play_history_json: None,
        play_next_track_ids_json: None,
        repeat_one_pending: false,
    };
    let result = QueueNavigationResult {
        action: "play".to_string(),
        track: Some(track(7, "/music/track7.mp3")),
        duration_ms: Some(123_456),
        snapshot: QueueStateSnapshot::new(vec![], &state),
    };

    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("\"action\":\"play\""));
    assert!(json.contains("\"duration_ms\":123456"));
    assert!(json.contains("track7.mp3"));
}
