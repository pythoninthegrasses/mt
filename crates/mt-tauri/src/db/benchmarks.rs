//! Performance benchmarks for the database layer.
//!
//! Run with: cargo test --release bench_ -- --nocapture --test-threads=1

#[cfg(test)]
mod tests {
    use crate::db::{library, playlists, queue, settings, Database, TrackMetadata};
    use serde_json::json;
    use std::time::Instant;

    fn create_test_track(i: usize) -> (String, TrackMetadata) {
        let filepath = format!("/music/artist{}/album{}/track{:04}.mp3", i % 100, i % 10, i);
        let metadata = TrackMetadata {
            title: Some(format!("Track {}", i)),
            artist: Some(format!("Artist {}", i % 100)),
            album: Some(format!("Album {}", i % 10)),
            album_artist: Some(format!("Artist {}", i % 100)),
            track_number: Some((i % 20 + 1).to_string()),
            track_total: Some("20".to_string()),
            date: Some("2024".to_string()),
            duration: Some((180 + (i % 120)) as f64),
            file_size: Some(5_000_000 + (i * 100) as i64),
            file_mtime_ns: None,
            file_inode: None,
            content_hash: None,
        };
        (filepath, metadata)
    }

    #[test]
    fn bench_database_initialization() {
        println!("\n=== Database Initialization Benchmark ===");

        let iterations = 100;
        let start = Instant::now();

        for _ in 0..iterations {
            let _db = Database::new_in_memory().expect("Failed to create database");
        }

        let elapsed = start.elapsed();
        let avg_ms = elapsed.as_secs_f64() * 1000.0 / iterations as f64;

        println!(
            "Created {} in-memory databases in {:?}",
            iterations, elapsed
        );
        println!("Average initialization time: {:.3} ms", avg_ms);
        println!("Includes: schema creation, 9 tables, indexes, migrations, PRAGMA settings");
    }

    #[test]
    fn bench_bulk_track_insertion() {
        println!("\n=== Bulk Track Insertion Benchmark ===");

        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");

        // Test various batch sizes
        for batch_size in [100, 500, 1000, 5000] {
            let tracks: Vec<(String, TrackMetadata)> =
                (0..batch_size).map(|i| create_test_track(i)).collect();

            let start = Instant::now();
            library::add_tracks_bulk(&conn, &tracks).expect("Failed to insert tracks");
            let elapsed = start.elapsed();

            let tracks_per_sec = batch_size as f64 / elapsed.as_secs_f64();
            println!(
                "Inserted {} tracks in {:?} ({:.0} tracks/sec)",
                batch_size, elapsed, tracks_per_sec
            );

            // Clear for next test
            conn.execute("DELETE FROM library", []).unwrap();
        }
    }

    #[test]
    fn bench_track_queries() {
        println!("\n=== Track Query Benchmark ===");

        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");

        // Insert test data
        let tracks: Vec<(String, TrackMetadata)> =
            (0..10000).map(|i| create_test_track(i)).collect();
        library::add_tracks_bulk(&conn, &tracks).expect("Failed to insert tracks");
        println!("Test data: 10,000 tracks inserted");

        // Benchmark simple query
        let iterations = 100;
        let start = Instant::now();
        for _ in 0..iterations {
            let query = library::LibraryQuery {
                limit: 50,
                ..Default::default()
            };
            let _result = library::get_all_tracks(&conn, &query).expect("Query failed");
        }
        let elapsed = start.elapsed();
        println!(
            "Simple query (limit 50): {:.3} ms avg ({} iterations)",
            elapsed.as_secs_f64() * 1000.0 / iterations as f64,
            iterations
        );

        // Benchmark search query
        let start = Instant::now();
        for _ in 0..iterations {
            let query = library::LibraryQuery {
                limit: 50,
                search: Some("Artist 5".to_string()),
                ..Default::default()
            };
            let _result = library::get_all_tracks(&conn, &query).expect("Query failed");
        }
        let elapsed = start.elapsed();
        println!(
            "Search query ('Artist 5'): {:.3} ms avg ({} iterations)",
            elapsed.as_secs_f64() * 1000.0 / iterations as f64,
            iterations
        );

        // Benchmark filtered query
        let start = Instant::now();
        for _ in 0..iterations {
            let query = library::LibraryQuery {
                limit: 50,
                artist: Some("Artist 10".to_string()),
                album: Some("Album 5".to_string()),
                ..Default::default()
            };
            let _result = library::get_all_tracks(&conn, &query).expect("Query failed");
        }
        let elapsed = start.elapsed();
        println!(
            "Filtered query (artist + album): {:.3} ms avg ({} iterations)",
            elapsed.as_secs_f64() * 1000.0 / iterations as f64,
            iterations
        );

        // Benchmark get_library_stats
        let start = Instant::now();
        for _ in 0..iterations {
            let _stats = library::get_library_stats(&conn).expect("Stats failed");
        }
        let elapsed = start.elapsed();
        println!(
            "Library stats: {:.3} ms avg ({} iterations)",
            elapsed.as_secs_f64() * 1000.0 / iterations as f64,
            iterations
        );
    }

    #[test]
    fn bench_queue_operations() {
        println!("\n=== Queue Operations Benchmark ===");

        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");

        // Insert test tracks first
        let tracks: Vec<(String, TrackMetadata)> =
            (0..1000).map(|i| create_test_track(i)).collect();
        library::add_tracks_bulk(&conn, &tracks).expect("Failed to insert tracks");

        // Benchmark adding to queue
        let filepaths: Vec<String> = (0..100)
            .map(|i| format!("/music/artist{}/album{}/track{:04}.mp3", i % 100, i % 10, i))
            .collect();

        let start = Instant::now();
        queue::add_files_to_queue(&conn, &filepaths, None).expect("Add to queue failed");
        let elapsed = start.elapsed();
        println!("Added {} items to queue: {:?}", filepaths.len(), elapsed);

        // Benchmark get queue
        let iterations = 100;
        let start = Instant::now();
        for _ in 0..iterations {
            let _queue = queue::get_queue(&conn).expect("Get queue failed");
        }
        let elapsed = start.elapsed();
        println!(
            "Get queue (100 items): {:.3} ms avg ({} iterations)",
            elapsed.as_secs_f64() * 1000.0 / iterations as f64,
            iterations
        );

        // Benchmark clear queue
        let start = Instant::now();
        queue::clear_queue(&conn).expect("Clear queue failed");
        let elapsed = start.elapsed();
        println!("Clear queue: {:?}", elapsed);
    }

    #[test]
    fn bench_playlist_operations() {
        println!("\n=== Playlist Operations Benchmark ===");

        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");

        // Insert test tracks
        let tracks: Vec<(String, TrackMetadata)> =
            (0..1000).map(|i| create_test_track(i)).collect();
        library::add_tracks_bulk(&conn, &tracks).expect("Failed to insert tracks");

        // Get track IDs
        let query = library::LibraryQuery {
            limit: 100,
            ..Default::default()
        };
        let result = library::get_all_tracks(&conn, &query).expect("Get tracks failed");
        let track_ids: Vec<i64> = result.items.iter().map(|t| t.id).collect();

        // Benchmark create playlist
        let iterations = 50;
        let start = Instant::now();
        for i in 0..iterations {
            playlists::create_playlist(&conn, &format!("Playlist {}", i))
                .expect("Create playlist failed");
        }
        let elapsed = start.elapsed();
        println!(
            "Create playlist: {:.3} ms avg ({} iterations)",
            elapsed.as_secs_f64() * 1000.0 / iterations as f64,
            iterations
        );

        // Benchmark add tracks to playlist
        let start = Instant::now();
        playlists::add_tracks_to_playlist(&conn, 1, &track_ids, None).expect("Add tracks failed");
        let elapsed = start.elapsed();
        println!("Add {} tracks to playlist: {:?}", track_ids.len(), elapsed);

        // Benchmark get playlist with tracks
        let start = Instant::now();
        for _ in 0..iterations {
            let _playlist = playlists::get_playlist(&conn, 1).expect("Get playlist failed");
        }
        let elapsed = start.elapsed();
        println!(
            "Get playlist with tracks: {:.3} ms avg ({} iterations)",
            elapsed.as_secs_f64() * 1000.0 / iterations as f64,
            iterations
        );

        // Benchmark list playlists
        let start = Instant::now();
        for _ in 0..iterations {
            let _playlists = playlists::get_playlists(&conn).expect("List playlists failed");
        }
        let elapsed = start.elapsed();
        println!(
            "List playlists (50 playlists): {:.3} ms avg ({} iterations)",
            elapsed.as_secs_f64() * 1000.0 / iterations as f64,
            iterations
        );
    }

    #[test]
    fn bench_settings_operations() {
        println!("\n=== Settings Operations Benchmark ===");

        let db = Database::new_in_memory().expect("Failed to create database");
        let conn = db.conn().expect("Failed to get connection");

        let iterations = 1000;

        // Benchmark set setting
        let start = Instant::now();
        for i in 0..iterations {
            let value = json!(format!("value_{}", i));
            settings::set_setting(&conn, &format!("key_{}", i), &value)
                .expect("Set setting failed");
        }
        let elapsed = start.elapsed();
        println!(
            "Set setting: {:.3} ms avg ({} iterations)",
            elapsed.as_secs_f64() * 1000.0 / iterations as f64,
            iterations
        );

        // Benchmark get setting
        let start = Instant::now();
        for i in 0..iterations {
            let _value = settings::get_setting(&conn, &format!("key_{}", i % 100))
                .expect("Get setting failed");
        }
        let elapsed = start.elapsed();
        println!(
            "Get setting: {:.3} ms avg ({} iterations)",
            elapsed.as_secs_f64() * 1000.0 / iterations as f64,
            iterations
        );

        // Benchmark get all settings
        let start = Instant::now();
        for _ in 0..100 {
            let _all = settings::get_all_settings(&conn).expect("Get all failed");
        }
        let elapsed = start.elapsed();
        println!(
            "Get all settings (1000 entries): {:.3} ms avg (100 iterations)",
            elapsed.as_secs_f64() * 1000.0 / 100.0
        );
    }

    #[test]
    fn bench_connection_pool() {
        println!("\n=== Connection Pool Benchmark ===");

        let db = Database::new_in_memory().expect("Failed to create database");

        let iterations = 1000;

        // Benchmark acquiring connections
        let start = Instant::now();
        for _ in 0..iterations {
            let _conn = db.conn().expect("Failed to get connection");
        }
        let elapsed = start.elapsed();
        println!(
            "Acquire connection: {:.3} ms avg ({} iterations)",
            elapsed.as_secs_f64() * 1000.0 / iterations as f64,
            iterations
        );

        // Benchmark with_conn helper
        let start = Instant::now();
        for i in 0..iterations {
            db.with_conn(|conn| {
                let value = json!(format!("value_{}", i));
                settings::set_setting(conn, "test_key", &value)
            })
            .expect("with_conn failed");
        }
        let elapsed = start.elapsed();
        println!(
            "with_conn + operation: {:.3} ms avg ({} iterations)",
            elapsed.as_secs_f64() * 1000.0 / iterations as f64,
            iterations
        );

        // Benchmark transaction helper
        let start = Instant::now();
        for i in 0..100 {
            db.transaction(|conn| {
                for j in 0..10 {
                    let value = json!("value");
                    settings::set_setting(conn, &format!("tx_key_{}_{}", i, j), &value)?;
                }
                Ok(())
            })
            .expect("transaction failed");
        }
        let elapsed = start.elapsed();
        println!(
            "Transaction (10 ops each): {:.3} ms avg (100 iterations)",
            elapsed.as_secs_f64() * 1000.0 / 100.0
        );
    }
}
