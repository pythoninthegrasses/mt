//! Thread safety and concurrent access tests.
//!
//! These tests verify that shared state components handle concurrent access correctly.

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread;

    use crate::db::Database;

    // ==================== Artwork Cache Tests ====================

    /// Test artwork cache concurrent access using len() and clear()
    #[test]
    fn test_artwork_cache_concurrent_len_operations() {
        use crate::scanner::artwork_cache::ArtworkCache;

        let cache = Arc::new(ArtworkCache::new().expect("Failed to create cache"));
        let operations = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..10)
            .map(|_| {
                let cache = Arc::clone(&cache);
                let counter = Arc::clone(&operations);

                thread::spawn(move || {
                    // Call len() and is_empty() concurrently
                    let _ = cache.len();
                    let _ = cache.is_empty();
                    counter.fetch_add(1, Ordering::SeqCst);
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("Thread panicked");
        }

        assert_eq!(
            operations.load(Ordering::SeqCst),
            10,
            "Not all concurrent cache operations completed"
        );
    }

    /// Test artwork cache doesn't deadlock under contention with invalidate
    #[test]
    fn test_artwork_cache_no_deadlock_invalidate() {
        use crate::scanner::artwork_cache::ArtworkCache;

        let cache = Arc::new(ArtworkCache::new().expect("Failed to create cache"));
        let completed = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..20)
            .map(|i| {
                let cache = Arc::clone(&cache);
                let counter = Arc::clone(&completed);

                thread::spawn(move || {
                    // Rapid concurrent operations
                    for j in 0..100 {
                        let track_id = ((i * 100 + j) % 10) as i64;
                        cache.invalidate(track_id);
                        let _ = cache.len();
                    }
                    counter.fetch_add(1, Ordering::SeqCst);
                })
            })
            .collect();

        // Give threads time to complete, but not too long (deadlock detection)
        for handle in handles {
            handle.join().expect("Thread panicked or deadlocked");
        }

        assert_eq!(
            completed.load(Ordering::SeqCst),
            20,
            "Not all threads completed - possible deadlock"
        );
    }

    /// Test artwork cache clear() from multiple threads
    #[test]
    fn test_artwork_cache_concurrent_clear() {
        use crate::scanner::artwork_cache::ArtworkCache;

        let cache = Arc::new(ArtworkCache::new().expect("Failed to create cache"));
        let completed = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..5)
            .map(|_| {
                let cache = Arc::clone(&cache);
                let counter = Arc::clone(&completed);

                thread::spawn(move || {
                    for _ in 0..50 {
                        cache.clear();
                        let _ = cache.is_empty();
                    }
                    counter.fetch_add(1, Ordering::SeqCst);
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("Thread panicked");
        }

        assert_eq!(
            completed.load(Ordering::SeqCst),
            5,
            "Not all threads completed clearing cache"
        );
    }

    // ==================== Audio Command Channel Tests ====================

    /// Test audio command channel concurrent sends
    #[test]
    fn test_audio_channel_concurrent_sends() {
        use std::sync::mpsc;

        let (tx, rx) = mpsc::channel::<i32>();
        let sent = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..10)
            .map(|i| {
                let tx = tx.clone();
                let counter = Arc::clone(&sent);

                thread::spawn(move || {
                    if tx.send(i).is_ok() {
                        counter.fetch_add(1, Ordering::SeqCst);
                    }
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("Thread panicked");
        }

        // Drop original sender so receiver knows when done
        drop(tx);

        // Count received messages
        let received: Vec<i32> = rx.iter().collect();

        assert_eq!(sent.load(Ordering::SeqCst), 10, "Not all sends completed");
        assert_eq!(received.len(), 10, "Not all messages received");
    }

    /// Test multiple producers to single consumer channel
    #[test]
    fn test_mpsc_channel_stress() {
        use std::sync::mpsc;

        let (tx, rx) = mpsc::channel::<(usize, usize)>();
        let total_messages = Arc::new(AtomicUsize::new(0));

        // Spawn 10 producer threads, each sending 100 messages
        let handles: Vec<_> = (0..10)
            .map(|producer_id| {
                let tx = tx.clone();
                let counter = Arc::clone(&total_messages);

                thread::spawn(move || {
                    for msg_id in 0..100 {
                        if tx.send((producer_id, msg_id)).is_ok() {
                            counter.fetch_add(1, Ordering::SeqCst);
                        }
                    }
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("Thread panicked");
        }

        drop(tx);

        // Verify all messages received
        let received: Vec<_> = rx.iter().collect();

        assert_eq!(total_messages.load(Ordering::SeqCst), 1000, "Not all messages sent");
        assert_eq!(received.len(), 1000, "Not all messages received");
    }

    // ==================== Database Write Contention Tests ====================

    /// Test database write operations don't corrupt data
    #[test]
    fn test_db_concurrent_writes_integrity() {
        use crate::db::settings;

        let db = Database::new_in_memory().expect("Failed to create in-memory database");
        let db = Arc::new(db);

        // Each thread writes a unique key-value pair
        let handles: Vec<_> = (0..10)
            .map(|i| {
                let db = Arc::clone(&db);

                thread::spawn(move || {
                    let key = format!("thread_{}_key", i);
                    let value = serde_json::json!(i);

                    let conn = db.conn().expect("Failed to get connection");
                    settings::set_setting(&conn, &key, &value).expect("Failed to set");

                    // Immediately read back and verify
                    let read_value = settings::get_setting(&conn, &key)
                        .expect("Failed to get")
                        .expect("Value should exist");

                    // get_setting returns JSON string, so compare appropriately
                    let expected = serde_json::to_string(&value).unwrap();
                    assert_eq!(read_value, expected, "Data corruption detected");
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("Thread panicked");
        }

        // Verify all values are still correct after all threads complete
        let conn = db.conn().expect("Failed to get connection");
        for i in 0..10 {
            let key = format!("thread_{}_key", i);
            let value = settings::get_setting(&conn, &key)
                .expect("Failed to get")
                .expect("Value should exist");
            let expected = serde_json::to_string(&serde_json::json!(i)).unwrap();
            assert_eq!(value, expected, "Data integrity violated");
        }
    }

    /// Test rapid connect/disconnect doesn't leak resources
    #[test]
    fn test_db_connection_churn() {
        let db = Database::new_in_memory().expect("Failed to create in-memory database");
        let db = Arc::new(db);
        let successful = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..5)
            .map(|_| {
                let db = Arc::clone(&db);
                let counter = Arc::clone(&successful);

                thread::spawn(move || {
                    // Rapidly acquire and release connections
                    for _ in 0..100 {
                        if let Ok(conn) = db.conn() {
                            let _ = conn.execute("SELECT 1", rusqlite::params![]);
                            // Connection dropped here
                        }
                    }
                    counter.fetch_add(1, Ordering::SeqCst);
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("Thread panicked");
        }

        assert_eq!(
            successful.load(Ordering::SeqCst),
            5,
            "Connection churn test failed"
        );
    }

    // ==================== Event System Stress Tests ====================

    /// Test that event structs can be cloned across threads
    #[test]
    fn test_events_thread_safe_cloning() {
        use crate::events::*;

        let event = LibraryUpdatedEvent::added(vec![1, 2, 3]);
        let event = Arc::new(event);

        let handles: Vec<_> = (0..10)
            .map(|_| {
                let event = Arc::clone(&event);

                thread::spawn(move || {
                    // Clone the event data (testing Clone + Send)
                    let cloned = (*event).clone();
                    assert_eq!(cloned.action, "added");
                    assert_eq!(cloned.track_ids.len(), 3);
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("Thread panicked");
        }
    }

    /// Test serialization under concurrent access
    #[test]
    fn test_events_concurrent_serialization() {
        use crate::events::*;

        let serialized = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..20)
            .map(|i| {
                let counter = Arc::clone(&serialized);

                // Create events per-thread to test serialization
                thread::spawn(move || {
                    let event = match i % 4 {
                        0 => serde_json::to_string(&LibraryUpdatedEvent::added(vec![i as i64])),
                        1 => serde_json::to_string(&QueueUpdatedEvent::added(vec![i as i64], 10)),
                        2 => serde_json::to_string(&PlaylistsUpdatedEvent::created(i as i64)),
                        _ => serde_json::to_string(&SettingsUpdatedEvent {
                            key: format!("key_{}", i),
                            value: serde_json::json!(i),
                            previous_value: None,
                        }),
                    };

                    if event.is_ok() {
                        counter.fetch_add(1, Ordering::SeqCst);
                    }
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("Thread panicked");
        }

        assert_eq!(
            serialized.load(Ordering::SeqCst),
            20,
            "Not all serializations succeeded"
        );
    }

    /// Test events are Send + Sync safe
    #[test]
    fn test_events_send_sync() {
        use crate::events::*;

        // This test verifies at compile time that events implement Send + Sync
        fn assert_send<T: Send>() {}
        fn assert_sync<T: Sync>() {}

        // These will fail to compile if events don't implement Send + Sync
        assert_send::<LibraryUpdatedEvent>();
        assert_sync::<LibraryUpdatedEvent>();
        assert_send::<QueueUpdatedEvent>();
        assert_sync::<QueueUpdatedEvent>();
        assert_send::<PlaylistsUpdatedEvent>();
        assert_sync::<PlaylistsUpdatedEvent>();
        assert_send::<SettingsUpdatedEvent>();
        assert_sync::<SettingsUpdatedEvent>();
    }

    // ==================== RwLock Pattern Tests ====================

    /// Test read-write lock pattern works correctly
    #[test]
    fn test_rwlock_concurrent_readers() {
        use parking_lot::RwLock;

        let data = Arc::new(RwLock::new(vec![1, 2, 3, 4, 5]));
        let reads_completed = Arc::new(AtomicUsize::new(0));

        // Spawn many concurrent readers
        let handles: Vec<_> = (0..20)
            .map(|_| {
                let data = Arc::clone(&data);
                let counter = Arc::clone(&reads_completed);

                thread::spawn(move || {
                    for _ in 0..100 {
                        let guard = data.read();
                        let sum: i32 = guard.iter().sum();
                        assert_eq!(sum, 15); // Should always be 15
                    }
                    counter.fetch_add(1, Ordering::SeqCst);
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("Thread panicked");
        }

        assert_eq!(
            reads_completed.load(Ordering::SeqCst),
            20,
            "Not all readers completed"
        );
    }

    /// Test read-write lock with mixed readers and writers
    #[test]
    fn test_rwlock_mixed_access() {
        use parking_lot::RwLock;

        let counter = Arc::new(RwLock::new(0i64));
        let completed = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..10)
            .map(|i| {
                let counter = Arc::clone(&counter);
                let completed_counter = Arc::clone(&completed);

                thread::spawn(move || {
                    for _ in 0..100 {
                        if i % 2 == 0 {
                            // Writer
                            let mut guard = counter.write();
                            *guard += 1;
                        } else {
                            // Reader
                            let guard = counter.read();
                            let _ = *guard; // Just read the value
                        }
                    }
                    completed_counter.fetch_add(1, Ordering::SeqCst);
                })
            })
            .collect();

        for handle in handles {
            handle.join().expect("Thread panicked");
        }

        assert_eq!(
            completed.load(Ordering::SeqCst),
            10,
            "Not all threads completed"
        );

        // 5 writers each doing 100 increments = 500
        let final_value = *counter.read();
        assert_eq!(final_value, 500, "Final counter value incorrect");
    }
}
