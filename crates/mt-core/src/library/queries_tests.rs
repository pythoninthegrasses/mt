//! Tests for the response shapes and for the query [`super::get_all_query`]
//! builds from command arguments.
//!
//! The serialization tests came across with the code from `mt-tauri`. The
//! `get_all_query` tests are new: that function is now the single definition of
//! what a `library_get_all` request means, and the desktop shadow-diff adapter
//! depends on it defaulting fields the same way for both the Rust and Zig sides
//! of the comparison. The queries that *run* the built query are in
//! [`read_tests`].

use super::*;
use crate::db::{LibrarySortColumn, SortOrder};

// =========================================================================
// LibraryResponse tests
// =========================================================================

#[test]
fn test_library_response_serialization() {
    let response = LibraryResponse {
        tracks: vec![],
        total: 0,
        limit: 100,
        offset: 0,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"total\":0"));
    assert!(json.contains("\"limit\":100"));
}

#[test]
fn test_library_response_with_pagination() {
    let response = LibraryResponse {
        tracks: vec![],
        total: 500,
        limit: 50,
        offset: 100,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"total\":500"));
    assert!(json.contains("\"limit\":50"));
    assert!(json.contains("\"offset\":100"));
}

#[test]
fn test_library_response_clone() {
    let response = LibraryResponse {
        tracks: vec![],
        total: 10,
        limit: 10,
        offset: 0,
    };

    let cloned = response.clone();
    assert_eq!(response.total, cloned.total);
    assert_eq!(response.limit, cloned.limit);
    assert_eq!(response.offset, cloned.offset);
}

#[test]
fn test_library_response_large_values() {
    let response = LibraryResponse {
        tracks: vec![],
        total: 1_000_000,
        limit: 1000,
        offset: 999_000,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"total\":1000000"));
}

// =========================================================================
// MissingTracksResponse tests
// =========================================================================

#[test]
fn test_missing_tracks_response_serialization() {
    let response = MissingTracksResponse {
        tracks: vec![],
        total: 0,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"tracks\":[]"));
    assert!(json.contains("\"total\":0"));
}

#[test]
fn test_missing_tracks_response_with_count() {
    let response = MissingTracksResponse {
        tracks: vec![],
        total: 25,
    };

    let json = serde_json::to_string(&response).unwrap();
    assert!(json.contains("\"total\":25"));
}

#[test]
fn test_missing_tracks_response_clone() {
    let response = MissingTracksResponse {
        tracks: vec![],
        total: 5,
    };

    let cloned = response.clone();
    assert_eq!(response.total, cloned.total);
    assert_eq!(response.tracks.len(), cloned.tracks.len());
}

// =========================================================================
// get_all_query tests
// =========================================================================

/// Every argument omitted: the defaults the frontend has always received.
#[test]
fn test_get_all_query_defaults() {
    let query = get_all_query(None, None, None, None, None, None, None, None, None);

    assert_eq!(query.limit, 100);
    assert_eq!(query.offset, 0);
    assert_eq!(query.sort_order, SortOrder::Desc);
    assert_eq!(query.sort_by, LibrarySortColumn::default());
    assert_eq!(query.search, None);
    assert_eq!(query.artist, None);
    assert_eq!(query.album, None);
    assert_eq!(query.ignore_words, None);
    assert_eq!(query.source_filter, None);
    // `library_get_all` never filtered on these, and the shadow-diff comparison
    // would break if a default appeared for one of them later.
    assert_eq!(query.genre, None);
    assert_eq!(query.year_from, None);
    assert_eq!(query.year_to, None);
}

#[test]
fn test_get_all_query_respects_limit_and_offset() {
    let query = get_all_query(
        None,
        None,
        None,
        None,
        None,
        Some(250),
        Some(1_000),
        None,
        None,
    );

    assert_eq!(query.limit, 250);
    assert_eq!(query.offset, 1_000);
}

#[test]
fn test_get_all_query_sort_order_is_case_insensitive() {
    for value in ["asc", "Asc", "ASC", "ASc"] {
        let query = get_all_query(
            None,
            None,
            None,
            None,
            Some(value.into()),
            None,
            None,
            None,
            None,
        );
        assert_eq!(
            query.sort_order,
            SortOrder::Asc,
            "{value} should be ascending"
        );
    }
}

/// Anything that is not "asc" — including garbage and the empty string — sorts
/// descending, which is what the frontend gets when a stored preference is stale.
#[test]
fn test_get_all_query_sort_order_falls_back_to_descending() {
    for value in ["desc", "DESC", "sideways", ""] {
        let query = get_all_query(
            None,
            None,
            None,
            None,
            Some(value.into()),
            None,
            None,
            None,
            None,
        );
        assert_eq!(
            query.sort_order,
            SortOrder::Desc,
            "{value} should be descending"
        );
    }

    let query = get_all_query(None, None, None, None, None, None, None, None, None);
    assert_eq!(query.sort_order, SortOrder::Desc);
}

#[test]
fn test_get_all_query_sort_column_parses_known_names() {
    let query = get_all_query(
        None,
        None,
        None,
        Some("title".into()),
        Some("asc".into()),
        None,
        None,
        None,
        None,
    );
    assert_eq!(query.sort_by, LibrarySortColumn::Title);

    let query = get_all_query(
        None,
        None,
        None,
        Some("play_count".into()),
        None,
        None,
        None,
        None,
        None,
    );
    assert_eq!(query.sort_by, LibrarySortColumn::PlayCount);

    // The frontend sends either name for the year column.
    for name in ["date", "year"] {
        let query = get_all_query(
            None,
            None,
            None,
            Some(name.into()),
            None,
            None,
            None,
            None,
            None,
        );
        assert_eq!(
            query.sort_by,
            LibrarySortColumn::Year,
            "{name} should sort by year"
        );
    }
}

/// An unknown column must not fail the request; it falls back to the default
/// column, which is what `parse().ok().unwrap_or_default()` meant.
#[test]
fn test_get_all_query_unknown_sort_column_uses_default() {
    let query = get_all_query(
        None,
        None,
        None,
        Some("not_a_column".into()),
        None,
        None,
        None,
        None,
        None,
    );
    assert_eq!(query.sort_by, LibrarySortColumn::default());
}

#[test]
fn test_get_all_query_passes_filters_through() {
    let query = get_all_query(
        Some("beatles".into()),
        Some("Abbey".into()),
        Some("Road".into()),
        None,
        None,
        None,
        None,
        Some("the,a,an".into()),
        Some("local".into()),
    );

    assert_eq!(query.search.as_deref(), Some("beatles"));
    assert_eq!(query.artist.as_deref(), Some("Abbey"));
    assert_eq!(query.album.as_deref(), Some("Road"));
    assert_eq!(query.ignore_words.as_deref(), Some("the,a,an"));
    assert_eq!(query.source_filter.as_deref(), Some("local"));
}
