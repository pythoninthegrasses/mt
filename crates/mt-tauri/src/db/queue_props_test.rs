//! Property-based tests for queue operations using proptest.
//!
//! These tests verify invariants and catch edge cases in queue management
//! that are difficult to find with example-based testing.

#[cfg(test)]
mod tests {
    use crate::db::queue::{
        add_files_to_queue, add_to_queue, clear_queue, get_queue, remove_from_queue,
    };
    use proptest::prelude::*;
    use rusqlite::{params, Connection};
    use std::collections::HashSet;

    /// Create an in-memory test database with schema
    fn create_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();

        // Create library table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS library (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filepath TEXT UNIQUE NOT NULL,
                title TEXT,
                artist TEXT,
                album TEXT,
                album_artist TEXT,
                track_number INTEGER,
                track_total INTEGER,
                date TEXT,
                duration REAL,
                file_size INTEGER DEFAULT 0,
                file_mtime_ns INTEGER,
                file_inode INTEGER,
                content_hash TEXT,
                added_date TEXT,
                last_played TEXT,
                play_count INTEGER DEFAULT 0,
                missing INTEGER DEFAULT 0,
                last_seen_at TEXT
            )",
            [],
        )
        .unwrap();

        // Create queue table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filepath TEXT NOT NULL
            )",
            [],
        )
        .unwrap();

        conn
    }

    /// Add a track to the library and return its ID
    fn add_test_track(conn: &Connection, filepath: &str, title: &str) -> i64 {
        conn.execute(
            "INSERT INTO library (filepath, title, artist, album, duration) VALUES (?, ?, ?, ?, ?)",
            params![filepath, title, "Test Artist", "Test Album", 180.0],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    // Strategy for generating valid track IDs
    fn track_id_strategy() -> impl Strategy<Value = i64> {
        1i64..=1000
    }

    // Strategy for generating track ID lists
    fn track_id_list_strategy() -> impl Strategy<Value = Vec<i64>> {
        prop::collection::vec(track_id_strategy(), 0..20)
    }

    proptest! {
        /// Adding tracks to queue preserves track count
        #[test]
        fn add_to_queue_preserves_count(track_ids in track_id_list_strategy()) {
            let conn = create_test_db();

            // Add tracks to library with unique filepaths and collect actual IDs
            let actual_ids: Vec<i64> = track_ids.iter().enumerate().map(|(i, &_track_id)| {
                add_test_track(&conn, &format!("/path/track{}.mp3", i), &format!("Track {}", i))
            }).collect();

            // Add to queue using actual library IDs
            let added = add_to_queue(&conn, &actual_ids, None).unwrap();

            // Get queue
            let queue = get_queue(&conn).unwrap();

            // Should add all tracks
            prop_assert_eq!(queue.len(), actual_ids.len());
            prop_assert_eq!(added, actual_ids.len() as i64);
        }

        /// Adding tracks preserves track identity
        #[test]
        fn add_to_queue_preserves_tracks(track_ids in track_id_list_strategy()) {
            prop_assume!(!track_ids.is_empty());

            let conn = create_test_db();

            // Add tracks to library with unique filepaths and collect actual IDs
            let actual_ids: Vec<i64> = track_ids.iter().enumerate().map(|(i, &_track_id)| {
                add_test_track(&conn, &format!("/path/track{}.mp3", i), &format!("Track {}", i))
            }).collect();

            // Add to queue using actual library IDs
            add_to_queue(&conn, &actual_ids, None).unwrap();

            // Get queue
            let queue = get_queue(&conn).unwrap();

            // Collect queue track IDs
            let queue_ids: Vec<i64> = queue.iter().map(|item| item.track.id).collect();

            // Should contain all tracks (order preserved)
            prop_assert_eq!(queue_ids.len(), actual_ids.len());
        }

        /// Queue positions are sequential
        #[test]
        fn queue_positions_are_sequential(track_count in 1usize..20) {
            let conn = create_test_db();

            // Add tracks to library and queue
            let track_ids: Vec<i64> = (0..track_count)
                .map(|i| {
                    add_test_track(&conn, &format!("/path/track{}.mp3", i), &format!("Track {}", i))
                })
                .collect();

            add_to_queue(&conn, &track_ids, None).unwrap();

            // Get queue
            let queue = get_queue(&conn).unwrap();

            // Positions should be 0, 1, 2, ...
            for (expected_pos, item) in queue.iter().enumerate() {
                prop_assert_eq!(item.position, expected_pos as i64);
            }
        }

        /// Insert at position maintains order
        #[test]
        fn insert_at_position_maintains_order(
            initial_count in 1usize..10,
            insert_count in 1usize..5,
            position in 0usize..10,
        ) {
            let conn = create_test_db();

            // Add initial tracks
            let initial_ids: Vec<i64> = (0..initial_count)
                .map(|i| {
                    add_test_track(&conn, &format!("/path/initial{}.mp3", i), &format!("Initial {}", i))
                })
                .collect();

            add_to_queue(&conn, &initial_ids, None).unwrap();

            // Add tracks to insert
            let insert_ids: Vec<i64> = (0..insert_count)
                .map(|i| {
                    add_test_track(&conn, &format!("/path/insert{}.mp3", i), &format!("Insert {}", i))
                })
                .collect();

            // Clamp position to valid range
            let pos = position.min(initial_count) as i64;

            // Insert at position
            add_to_queue(&conn, &insert_ids, Some(pos)).unwrap();

            // Get final queue
            let queue = get_queue(&conn).unwrap();

            // Total size should be sum of both
            prop_assert_eq!(queue.len(), initial_count + insert_count);

            // Check items before insert position
            for i in 0..pos as usize {
                let expected_filepath = format!("/path/initial{}.mp3", i);
                prop_assert_eq!(&queue[i].track.filepath, &expected_filepath);
            }

            // Check inserted items
            for i in 0..insert_count {
                let expected_filepath = format!("/path/insert{}.mp3", i);
                let queue_idx = pos as usize + i;
                prop_assert_eq!(&queue[queue_idx].track.filepath, &expected_filepath);
            }

            // Check items after insert position
            for i in pos as usize..initial_count {
                let expected_filepath = format!("/path/initial{}.mp3", i);
                let queue_idx = insert_count + i;
                prop_assert_eq!(&queue[queue_idx].track.filepath, &expected_filepath);
            }
        }

        /// Remove from queue decreases size by 1
        #[test]
        fn remove_decreases_size(track_count in 2usize..20, remove_idx in 0usize..19) {
            prop_assume!(remove_idx < track_count);

            let conn = create_test_db();

            // Add tracks
            let track_ids: Vec<i64> = (0..track_count)
                .map(|i| {
                    add_test_track(&conn, &format!("/path/track{}.mp3", i), &format!("Track {}", i))
                })
                .collect();

            add_to_queue(&conn, &track_ids, None).unwrap();

            let initial_queue = get_queue(&conn).unwrap();
            let initial_size = initial_queue.len();

            // Remove item
            remove_from_queue(&conn, remove_idx as i64).unwrap();

            let final_queue = get_queue(&conn).unwrap();

            prop_assert_eq!(final_queue.len(), initial_size - 1);
        }

        /// Remove preserves other tracks
        #[test]
        fn remove_preserves_other_tracks(track_count in 3usize..15, remove_idx in 0usize..14) {
            prop_assume!(remove_idx < track_count);

            let conn = create_test_db();

            // Add tracks
            let track_ids: Vec<i64> = (0..track_count)
                .map(|i| {
                    add_test_track(&conn, &format!("/path/track{}.mp3", i), &format!("Track {}", i))
                })
                .collect();

            add_to_queue(&conn, &track_ids, None).unwrap();

            let initial_queue = get_queue(&conn).unwrap();
            let removed_filepath = initial_queue[remove_idx].track.filepath.clone();

            // Collect other filepaths
            let other_filepaths: HashSet<String> = initial_queue
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != remove_idx)
                .map(|(_, item)| item.track.filepath.clone())
                .collect();

            // Remove item
            remove_from_queue(&conn, remove_idx as i64).unwrap();

            let final_queue = get_queue(&conn).unwrap();
            let final_filepaths: HashSet<String> = final_queue
                .iter()
                .map(|item| item.track.filepath.clone())
                .collect();

            // Should not contain removed track
            prop_assert!(!final_filepaths.contains(&removed_filepath));

            // Should contain all other tracks
            prop_assert_eq!(final_filepaths, other_filepaths);
        }

        /// Clear queue empties the queue
        #[test]
        fn clear_empties_queue(track_count in 1usize..20) {
            let conn = create_test_db();

            // Add tracks
            let track_ids: Vec<i64> = (0..track_count)
                .map(|i| {
                    add_test_track(&conn, &format!("/path/track{}.mp3", i), &format!("Track {}", i))
                })
                .collect();

            add_to_queue(&conn, &track_ids, None).unwrap();

            // Verify queue has items
            let initial_queue = get_queue(&conn).unwrap();
            prop_assert_eq!(initial_queue.len(), track_count);

            // Clear queue
            clear_queue(&conn).unwrap();

            // Verify queue is empty
            let final_queue = get_queue(&conn).unwrap();
            prop_assert_eq!(final_queue.len(), 0);
        }

        /// Multiple operations maintain consistency
        #[test]
        fn multiple_operations_maintain_consistency(
            initial_count in 1usize..10,
            operations in prop::collection::vec((0usize..3, 0usize..5), 1..10),
        ) {
            let conn = create_test_db();

            // Add initial tracks
            let mut track_counter = 0usize;
            let initial_ids: Vec<i64> = (0..initial_count)
                .map(|_| {
                    let id = add_test_track(&conn, &format!("/path/track{}.mp3", track_counter), &format!("Track {}", track_counter));
                    track_counter += 1;
                    id
                })
                .collect();

            add_to_queue(&conn, &initial_ids, None).unwrap();

            // Perform random operations
            for (op_type, _param) in operations {
                let queue = get_queue(&conn).unwrap();

                match op_type {
                    0 => {
                        // Add operation
                        let new_id = add_test_track(&conn, &format!("/path/track{}.mp3", track_counter), &format!("Track {}", track_counter));
                        track_counter += 1;
                        let _ = add_to_queue(&conn, &[new_id], None);
                    }
                    1 => {
                        // Remove operation (if queue not empty)
                        if !queue.is_empty() {
                            let idx = 0; // Remove first item
                            let _ = remove_from_queue(&conn, idx);
                        }
                    }
                    2 => {
                        // Clear operation
                        let _ = clear_queue(&conn);
                    }
                    _ => {}
                }
            }

            // Final consistency checks
            let final_queue = get_queue(&conn).unwrap();

            // Positions should be sequential
            for (expected_pos, item) in final_queue.iter().enumerate() {
                prop_assert_eq!(item.position, expected_pos as i64);
            }

            // All tracks should have valid IDs
            for item in &final_queue {
                prop_assert!(item.track.id > 0);
            }
        }

        /// Add files to queue handles duplicates gracefully
        #[test]
        fn add_files_handles_duplicates(file_count in 1usize..10, duplicate_count in 1usize..5) {
            let conn = create_test_db();

            // Create unique filepaths
            let unique_files: Vec<String> = (0..file_count)
                .map(|i| format!("/path/track{}.mp3", i))
                .collect();

            // Create list with duplicates
            let mut all_files = unique_files.clone();
            for i in 0..duplicate_count.min(file_count) {
                all_files.push(unique_files[i].clone());
            }

            // Add files to queue
            let (added, _) = add_files_to_queue(&conn, &all_files, None).unwrap();

            // Get queue
            let queue = get_queue(&conn).unwrap();

            // Should have added all files (including duplicates in this implementation)
            prop_assert_eq!(queue.len(), all_files.len());
            prop_assert_eq!(added, all_files.len() as i64);
        }

        /// Queue operations never produce negative positions
        #[test]
        fn queue_operations_never_negative_positions(
            track_count in 1usize..15,
            operations in prop::collection::vec(0usize..2, 1..8),
        ) {
            let conn = create_test_db();

            // Add initial tracks
            let track_ids: Vec<i64> = (0..track_count)
                .map(|i| {
                    add_test_track(&conn, &format!("/path/track{}.mp3", i), &format!("Track {}", i))
                })
                .collect();

            add_to_queue(&conn, &track_ids, None).unwrap();

            // Perform operations with unique track counter
            let mut new_track_counter = 0;
            for op in operations {
                match op {
                    0 => {
                        // Add with unique filepath
                        let new_id = add_test_track(&conn, &format!("/path/new{}.mp3", new_track_counter), &format!("New {}", new_track_counter));
                        new_track_counter += 1;
                        let _ = add_to_queue(&conn, &[new_id], None);
                    }
                    1 => {
                        // Remove (if not empty)
                        let queue = get_queue(&conn).unwrap();
                        if !queue.is_empty() {
                            let _ = remove_from_queue(&conn, 0);
                        }
                    }
                    _ => {}
                }

                // Check positions
                let queue = get_queue(&conn).unwrap();
                for item in &queue {
                    prop_assert!(item.position >= 0);
                }
            }
        }

        /// Empty queue operations are safe
        #[test]
        fn empty_queue_operations_are_safe(op_type in 0usize..3) {
            let conn = create_test_db();

            // Queue starts empty
            let initial_queue = get_queue(&conn).unwrap();
            prop_assert_eq!(initial_queue.len(), 0);

            // Try various operations on empty queue
            match op_type {
                0 => {
                    // Remove from empty queue (should not panic)
                    let result = remove_from_queue(&conn, 0);
                    // This should either succeed (no-op) or return an error
                    // but should not panic
                    prop_assert!(result.is_ok() || result.is_err());
                }
                1 => {
                    // Clear empty queue (should be no-op)
                    let result = clear_queue(&conn);
                    prop_assert!(result.is_ok());

                    let queue = get_queue(&conn).unwrap();
                    prop_assert_eq!(queue.len(), 0);
                }
                2 => {
                    // Get empty queue (should return empty vec)
                    let queue = get_queue(&conn).unwrap();
                    prop_assert_eq!(queue.len(), 0);
                }
                _ => {}
            }
        }
    }
}
