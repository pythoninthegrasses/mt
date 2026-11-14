//! Tests for the queries that read the library: the paged page, the prefix and
//! track-id offset jumps, and the summary endpoints.
//!
//! The pagination, sort-order, and path-handling blocks came across with the
//! code from `mt-tauri`; the offset tests are new and pin behavior the desktop
//! scroll position depends on.

use std::path::Path;

use super::*;
use crate::db::{SortOrder, TrackMetadata, library};
use crate::library::test_util::{add_track, sample_db};

// =========================================================================
// get_all tests
// =========================================================================

#[test]
fn test_get_all_returns_page_and_totals() {
    let db = sample_db();
    for i in 1..=5 {
        add_track(&db, i, 60.0 * i as f64);
    }

    let query = get_all_query(None, None, None, None, None, Some(3), Some(0), None, None);
    let response = get_all(&db, &query).unwrap();

    assert_eq!(response.tracks.len(), 3);
    assert_eq!(response.total, 5);
    assert_eq!(response.limit, 3);
    assert_eq!(response.offset, 0);
}

/// The response echoes what was asked for, not what the page happened to
/// contain: the frontend paginates off these fields, so the last short page has
/// to report the requested limit rather than its row count.
#[test]
fn test_get_all_echoes_requested_limit_beyond_total() {
    let db = sample_db();
    for i in 1..=2 {
        add_track(&db, i, 60.0);
    }

    let query = get_all_query(None, None, None, None, None, Some(100), Some(0), None, None);
    let response = get_all(&db, &query).unwrap();

    assert_eq!(response.tracks.len(), 2);
    assert_eq!(response.total, 2);
    assert_eq!(response.limit, 100);
}

#[test]
fn test_get_all_search_narrows_total() {
    let db = sample_db();
    add_track(&db, 1, 60.0);
    let conn = db.conn().unwrap();
    let metadata = TrackMetadata {
        title: Some("Unique Song".to_string()),
        artist: Some("Special Artist".to_string()),
        duration: Some(120.0),
        ..Default::default()
    };
    library::add_track(&conn, "/music/unique.mp3", &metadata).unwrap();
    drop(conn);

    let query = get_all_query(
        Some("Unique".into()),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );
    let response = get_all(&db, &query).unwrap();

    assert_eq!(response.total, 1);
    assert_eq!(response.tracks.len(), 1);
    assert_eq!(response.tracks[0].title, Some("Unique Song".to_string()));
}

// =========================================================================
// get_count tests
// =========================================================================

#[test]
fn test_get_count_separates_filtered_and_total() {
    let db = sample_db();
    for i in 1..=4 {
        add_track(&db, i, 100.0);
    }

    let all = get_count(&db, None, None, None).unwrap();
    assert_eq!(all.total, 4);

    let filtered = get_count(&db, Some("Track 2".into()), None, None).unwrap();
    assert_eq!(filtered.total, 1);
}

// =========================================================================
// find_offset / find_track_offset tests
// =========================================================================

#[test]
fn test_find_track_offset_tracks_sort_order() {
    let db = sample_db();
    let conn = db.conn().unwrap();
    for (path, title) in [("/music/a.mp3", "Alpha"), ("/music/b.mp3", "Beta")] {
        let metadata = TrackMetadata {
            title: Some(title.to_string()),
            artist: Some("Artist".to_string()),
            duration: Some(60.0),
            ..Default::default()
        };
        library::add_track(&conn, path, &metadata).unwrap();
    }
    let beta = library::get_track_by_filepath(&conn, "/music/b.mp3")
        .unwrap()
        .unwrap()
        .id;
    drop(conn);

    let ascending = find_track_offset(
        &db,
        beta,
        None,
        None,
        None,
        Some("title".into()),
        Some("asc".into()),
        None,
    )
    .unwrap();
    assert_eq!(ascending, Some(1));

    let descending = find_track_offset(
        &db,
        beta,
        None,
        None,
        None,
        Some("title".into()),
        Some("desc".into()),
        None,
    )
    .unwrap();
    assert_eq!(descending, Some(0));
}

#[test]
fn test_find_track_offset_missing_track_is_none() {
    let db = sample_db();
    let offset = find_track_offset(&db, 999, None, None, None, None, None, None).unwrap();
    assert_eq!(offset, None);
}

/// The prefix jump is an artist jump whatever column is displayed: the frontend
/// types a letter and expects to land on the first row for that artist.
#[test]
fn test_find_offset_matches_artist_prefix() {
    let db = sample_db();
    add_track(&db, 1, 60.0);
    add_track(&db, 2, 60.0);

    let offset = find_offset(
        &db,
        None,
        None,
        None,
        Some("artist".into()),
        Some("asc".into()),
        None,
        "Artis".to_string(),
    )
    .unwrap();
    assert_eq!(offset, Some(0));
}

#[test]
fn test_find_offset_is_case_insensitive() {
    let db = sample_db();
    add_track(&db, 1, 60.0);

    let offset = find_offset(
        &db,
        None,
        None,
        None,
        Some("artist".into()),
        Some("asc".into()),
        None,
        "ARTIS".to_string(),
    )
    .unwrap();
    assert_eq!(offset, Some(0));
}

#[test]
fn test_find_offset_prefix_with_no_match_is_none() {
    let db = sample_db();
    add_track(&db, 1, 60.0);

    let offset = find_offset(
        &db,
        None,
        None,
        None,
        Some("artist".into()),
        Some("asc".into()),
        None,
        "zzz".to_string(),
    )
    .unwrap();
    assert_eq!(offset, None);
}

// =========================================================================
// get_stats / get_track / get_missing tests
// =========================================================================

#[test]
fn test_get_stats_counts_non_missing_tracks() {
    let db = sample_db();
    for i in 1..=3 {
        add_track(&db, i, 120.0);
    }

    let stats = get_stats(&db).unwrap();
    assert_eq!(stats.total_tracks, 3);
    assert_eq!(stats.total_duration, 360);
}

#[test]
fn test_get_track_returns_none_for_unknown_id() {
    let db = sample_db();
    assert!(get_track(&db, 4242).unwrap().is_none());
}

#[test]
fn test_get_track_round_trips_metadata() {
    let db = sample_db();
    let id = add_track(&db, 7, 210.0);

    let track = get_track(&db, id).unwrap().expect("track exists");
    assert_eq!(track.id, id);
    assert_eq!(track.title, Some("Track 7".to_string()));
    assert_eq!(track.filepath, "/music/track7.mp3");
}

#[test]
fn test_get_missing_reports_rows_and_total_together() {
    let db = sample_db();
    let id = add_track(&db, 1, 60.0);
    let conn = db.conn().unwrap();
    library::mark_track_missing(&conn, id).unwrap();
    drop(conn);

    let response = get_missing(&db).unwrap();
    assert_eq!(response.total, 1);
    assert_eq!(response.tracks.len(), 1);
    assert_eq!(response.total as usize, response.tracks.len());
}

// =========================================================================
// Pagination calculation tests
// =========================================================================

#[test]
fn test_pagination_first_page() {
    let limit = 50i64;
    let offset = 0i64;
    let total = 100i64;

    assert_eq!(offset, 0);
    assert!(offset + limit <= total || offset < total);
}

#[test]
fn test_pagination_middle_page() {
    let limit = 50i64;
    let offset = 50i64;

    let current_page = offset / limit + 1;
    assert_eq!(current_page, 2);
}

#[test]
fn test_pagination_last_page() {
    let total = 125i64;
    let offset = 100i64; // Last page with 25 items

    let remaining = total - offset;
    assert_eq!(remaining, 25);
}

#[test]
fn test_pagination_beyond_total() {
    let limit = 50i64;
    let total = 100i64;
    let offset = 150i64; // Beyond total

    let items_to_return = if offset >= total {
        0
    } else {
        (total - offset).min(limit)
    };
    assert_eq!(items_to_return, 0);
}

// =========================================================================
// Sort order parsing tests
// =========================================================================

#[test]
fn test_sort_order_asc() {
    let order_str = "asc";
    let sort_order = if order_str.to_lowercase() == "asc" {
        SortOrder::Asc
    } else {
        SortOrder::Desc
    };
    assert!(matches!(sort_order, SortOrder::Asc));
}

#[test]
fn test_sort_order_desc() {
    let order_str = "desc";
    let sort_order = if order_str.to_lowercase() == "asc" {
        SortOrder::Asc
    } else {
        SortOrder::Desc
    };
    assert!(matches!(sort_order, SortOrder::Desc));
}

#[test]
fn test_sort_order_case_insensitive() {
    let orders = ["ASC", "Asc", "asc", "ASc"];
    for order_str in orders {
        let sort_order = if order_str.to_lowercase() == "asc" {
            SortOrder::Asc
        } else {
            SortOrder::Desc
        };
        assert!(matches!(sort_order, SortOrder::Asc));
    }
}

#[test]
fn test_sort_order_default_to_desc() {
    let order_str = "invalid";
    let sort_order = if order_str.to_lowercase() == "asc" {
        SortOrder::Asc
    } else {
        SortOrder::Desc
    };
    assert!(matches!(sort_order, SortOrder::Desc));
}

// =========================================================================
// Path handling tests
// =========================================================================

#[test]
fn test_path_exists_check() {
    // Using a path that definitely doesn't exist
    let path = Path::new("/nonexistent/path/to/file.mp3");
    assert!(!path.exists());
}

#[test]
fn test_path_from_string() {
    let path_str = "/Users/test/Music/track.mp3";
    let path = Path::new(path_str);
    assert_eq!(path.to_str(), Some(path_str));
}

#[test]
fn test_path_with_spaces() {
    let path_str = "/Users/test/My Music/My Track.mp3";
    let path = Path::new(path_str);
    assert_eq!(path.to_str(), Some(path_str));
}

#[test]
fn test_path_with_unicode() {
    let path_str = "/Users/test/音楽/曲.mp3";
    let path = Path::new(path_str);
    assert_eq!(path.to_str(), Some(path_str));
}
