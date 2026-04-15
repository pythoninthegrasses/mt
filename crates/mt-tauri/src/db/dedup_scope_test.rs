//! Regression tests for cross-directory dedup persistence (TASK-335).
//!
//! Verifies that Phase 2 hash dedup only merges within-directory duplicates,
//! leaving cross-directory duplicates for Phase 3 (which writes suppression
//! rows to `deduplicated_tracks`).

#[cfg(test)]
mod tests {
    use crate::db::TrackMetadata;
    use crate::db::dedup;
    use crate::db::library::{
        self, DuplicateCandidate, filter_within_directory_groups, find_cross_directory_duplicates,
        find_duplicates_by_content_hash, merge_duplicate_tracks,
    };
    use crate::db::schema::{create_tables, run_migrations};
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn add_track_with_hash(conn: &Connection, path: &str, hash: &str) -> i64 {
        let metadata = TrackMetadata {
            title: Some(path.to_string()),
            content_hash: Some(hash.to_string()),
            ..Default::default()
        };
        library::add_track(conn, path, &metadata).unwrap()
    }

    // =========================================================================
    // filter_within_directory_groups
    // =========================================================================

    #[test]
    fn filter_keeps_same_directory_group() {
        let groups = vec![vec![
            make_candidate(1, "/music/dir_a/song1.mp3", "sha256:aaa"),
            make_candidate(2, "/music/dir_a/song1_copy.mp3", "sha256:aaa"),
        ]];
        let folders = vec!["/music/dir_a".to_string(), "/music/dir_b".to_string()];

        let filtered = filter_within_directory_groups(groups, &folders);
        assert_eq!(filtered.len(), 1, "same-directory group should be kept");
        assert_eq!(filtered[0].len(), 2);
    }

    #[test]
    fn filter_removes_cross_directory_group() {
        let groups = vec![vec![
            make_candidate(1, "/music/dir_a/song.mp3", "sha256:aaa"),
            make_candidate(2, "/music/dir_b/song.mp3", "sha256:aaa"),
        ]];
        let folders = vec!["/music/dir_a".to_string(), "/music/dir_b".to_string()];

        let filtered = filter_within_directory_groups(groups, &folders);
        assert!(
            filtered.is_empty(),
            "cross-directory group should be removed"
        );
    }

    #[test]
    fn filter_mixed_groups_keeps_only_within_directory() {
        let groups = vec![
            // Group 1: same directory (keep)
            vec![
                make_candidate(1, "/music/dir_a/song1.mp3", "sha256:aaa"),
                make_candidate(2, "/music/dir_a/song1_copy.mp3", "sha256:aaa"),
            ],
            // Group 2: cross-directory (remove)
            vec![
                make_candidate(3, "/music/dir_a/song2.mp3", "sha256:bbb"),
                make_candidate(4, "/music/dir_b/song2.mp3", "sha256:bbb"),
            ],
            // Group 3: same directory (keep)
            vec![
                make_candidate(5, "/music/dir_b/song3.mp3", "sha256:ccc"),
                make_candidate(6, "/music/dir_b/song3_copy.mp3", "sha256:ccc"),
            ],
        ];
        let folders = vec!["/music/dir_a".to_string(), "/music/dir_b".to_string()];

        let filtered = filter_within_directory_groups(groups, &folders);
        assert_eq!(
            filtered.len(),
            2,
            "only same-directory groups should remain"
        );
    }

    #[test]
    fn filter_with_no_watched_folders_returns_all() {
        let groups = vec![vec![
            make_candidate(1, "/music/dir_a/song.mp3", "sha256:aaa"),
            make_candidate(2, "/music/dir_b/song.mp3", "sha256:aaa"),
        ]];
        let folders: Vec<String> = vec![];

        // 1 group in
        let filtered = filter_within_directory_groups(groups, &folders);
        assert_eq!(
            filtered.len(),
            1,
            "with no watched folders, all groups pass through"
        );
    }

    #[test]
    fn filter_with_single_watched_folder_returns_all() {
        let groups = vec![vec![
            make_candidate(1, "/music/dir_a/song.mp3", "sha256:aaa"),
            make_candidate(2, "/music/dir_a/sub/song.mp3", "sha256:aaa"),
        ]];
        let folders = vec!["/music/dir_a".to_string()];

        // 1 group in
        let filtered = filter_within_directory_groups(groups, &folders);
        assert_eq!(
            filtered.len(),
            1,
            "with single watched folder, all groups are within-directory"
        );
    }

    #[test]
    fn filter_handles_trailing_slash_in_folder_paths() {
        let groups = vec![vec![
            make_candidate(1, "/music/dir_a/song.mp3", "sha256:aaa"),
            make_candidate(2, "/music/dir_b/song.mp3", "sha256:aaa"),
        ]];
        let folders = vec!["/music/dir_a/".to_string(), "/music/dir_b/".to_string()];

        let filtered = filter_within_directory_groups(groups, &folders);
        assert!(
            filtered.is_empty(),
            "trailing slashes should not affect directory matching"
        );
    }

    // =========================================================================
    // Integration: hash dedup + filter + cross-directory dedup pipeline
    // =========================================================================

    #[test]
    fn cross_directory_duplicates_not_merged_by_hash_dedup() {
        let conn = setup_test_db();

        // Two tracks with same content_hash in different watched directories
        let _id_a = add_track_with_hash(&conn, "/music/dir_a/song.mp3", "sha256:same");
        let _id_b = add_track_with_hash(&conn, "/music/dir_b/song.mp3", "sha256:same");

        let folders = vec!["/music/dir_a".to_string(), "/music/dir_b".to_string()];

        // find_duplicates_by_content_hash returns them as a group
        let hash_dups = find_duplicates_by_content_hash(&conn).unwrap();
        assert_eq!(hash_dups.len(), 1, "raw hash dedup finds the group");

        // But after filtering, the cross-directory group is excluded
        let filtered = filter_within_directory_groups(hash_dups, &folders);
        assert!(
            filtered.is_empty(),
            "cross-directory group must NOT be merged by Phase 2"
        );

        // Phase 3 should still find them
        let cross_dir = find_cross_directory_duplicates(&conn, &folders).unwrap();
        assert_eq!(
            cross_dir.len(),
            1,
            "Phase 3 should find cross-directory duplicates"
        );
        assert_eq!(cross_dir[0].len(), 2);
    }

    #[test]
    fn within_directory_duplicates_still_merged_by_hash_dedup() {
        let conn = setup_test_db();

        // Two tracks with same content_hash in the SAME watched directory
        let id_a = add_track_with_hash(&conn, "/music/dir_a/song.mp3", "sha256:same");
        let id_b = add_track_with_hash(&conn, "/music/dir_a/song_copy.mp3", "sha256:same");

        let folders = vec!["/music/dir_a".to_string(), "/music/dir_b".to_string()];

        let hash_dups = find_duplicates_by_content_hash(&conn).unwrap();
        let filtered = filter_within_directory_groups(hash_dups, &folders);
        assert_eq!(
            filtered.len(),
            1,
            "within-directory group should pass filter"
        );

        // Merge should work
        let merged = merge_duplicate_tracks(&conn, id_a, id_b).unwrap();
        assert!(merged, "within-directory duplicate should be merged");
    }

    #[test]
    fn cross_directory_dedup_writes_suppression_rows() {
        let conn = setup_test_db();

        // Simulate the full pipeline for cross-directory duplicates
        let id_a = add_track_with_hash(&conn, "/music/dir_a/song.mp3", "sha256:same");
        let id_b = add_track_with_hash(&conn, "/music/dir_b/song.mp3", "sha256:same");

        let folders = vec!["/music/dir_a".to_string(), "/music/dir_b".to_string()];

        // Phase 2: hash dedup with filter — should NOT merge cross-directory
        let hash_dups = find_duplicates_by_content_hash(&conn).unwrap();
        let filtered = filter_within_directory_groups(hash_dups, &folders);
        assert!(filtered.is_empty());

        // Phase 3: cross-directory dedup — should find and suppress
        let cross_dir = find_cross_directory_duplicates(&conn, &folders).unwrap();
        assert_eq!(cross_dir.len(), 1);

        let group = &cross_dir[0];
        let keep = &group[0];
        for dup in &group[1..] {
            dedup::suppress_track(
                &conn,
                keep.id,
                &dup.filepath,
                dup.content_hash.as_deref(),
                dup.file_ctime_ns,
                dup.file_mtime_ns,
            )
            .unwrap();
            merge_duplicate_tracks(&conn, keep.id, dup.id).unwrap();
        }

        // Verify suppression rows exist
        let suppressed = dedup::count_suppressed(&conn).unwrap();
        assert!(
            suppressed > 0,
            "cross-directory dedup MUST write suppression rows (got {suppressed})"
        );

        // Verify the kept track is one of our original tracks
        assert!(keep.id == id_a || keep.id == id_b);
    }

    #[test]
    fn three_directory_cross_dedup_produces_correct_suppressions() {
        let conn = setup_test_db();

        let _id_a = add_track_with_hash(&conn, "/music/dir_a/song.mp3", "sha256:same");
        let _id_b = add_track_with_hash(&conn, "/music/dir_b/song.mp3", "sha256:same");
        let _id_c = add_track_with_hash(&conn, "/music/dir_c/song.mp3", "sha256:same");

        let folders = vec![
            "/music/dir_a".to_string(),
            "/music/dir_b".to_string(),
            "/music/dir_c".to_string(),
        ];

        // Phase 2 filter should exclude the cross-directory group
        let hash_dups = find_duplicates_by_content_hash(&conn).unwrap();
        let filtered = filter_within_directory_groups(hash_dups, &folders);
        assert!(filtered.is_empty());

        // Phase 3 should find the group spanning 3 directories
        let cross_dir = find_cross_directory_duplicates(&conn, &folders).unwrap();
        assert_eq!(cross_dir.len(), 1);
        assert_eq!(cross_dir[0].len(), 3);

        // Suppress the duplicates
        let group = &cross_dir[0];
        let keep = &group[0];
        for dup in &group[1..] {
            dedup::suppress_track(
                &conn,
                keep.id,
                &dup.filepath,
                dup.content_hash.as_deref(),
                dup.file_ctime_ns,
                dup.file_mtime_ns,
            )
            .unwrap();
            merge_duplicate_tracks(&conn, keep.id, dup.id).unwrap();
        }

        assert_eq!(
            dedup::count_suppressed(&conn).unwrap(),
            2,
            "should suppress 2 of 3 duplicates"
        );
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    fn make_candidate(id: i64, filepath: &str, hash: &str) -> DuplicateCandidate {
        DuplicateCandidate {
            id,
            filepath: filepath.to_string(),
            missing: false,
            play_count: 0,
            added_date: None,
            file_ctime_ns: None,
            file_mtime_ns: None,
            content_hash: Some(hash.to_string()),
        }
    }
}
