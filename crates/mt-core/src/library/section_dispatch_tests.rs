//! Tests for the public [`super::get_section`] dispatch: the one entry point
//! the frontend's section requests reach, on a pooled database.
//!
//! These are new. The per-section helpers they route to are covered in
//! [`crate::library::section::tests`]; what this file pins is the dispatch
//! contract itself — page defaults, the local/remote split in the totals, the
//! clamped settings values, and the error strings the frontend shows.

use super::*;
use crate::db::{TrackMetadata, favorites, library};
use crate::library::test_util::{add_track, mark_remote, sample_db};

// =========================================================================
// get_section dispatch
// =========================================================================

/// The default page size and the `page`/`page_size` pair the frontend's page
/// cache keys off, asserted through the dispatch entry rather than the helper.
#[test]
fn test_get_section_all_defaults_to_500_row_pages() {
    let db = sample_db();
    for i in 1..=3 {
        add_track(&db, i, 60.0);
    }

    let resp = get_section(
        &db,
        "all".into(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(resp.section, "all");
    assert_eq!(resp.tracks.len(), 3);
    assert_eq!(resp.page, Some(0));
    assert_eq!(resp.page_size, Some(500));
    assert!(!resp.has_more);
}

#[test]
fn test_get_section_reports_second_page() {
    let db = sample_db();
    for i in 1..=5 {
        add_track(&db, i, 60.0);
    }

    let resp = get_section(
        &db,
        "all".into(),
        None,
        None,
        None,
        None,
        None,
        Some(2),
        Some(2),
        None,
        None,
    )
    .unwrap();
    assert_eq!(resp.tracks.len(), 2);
    assert_eq!(resp.page, Some(1));
    assert_eq!(resp.page_size, Some(2));
    assert!(resp.has_more);
}

/// `local_file_count` is the footer's local-only figure: it tracks the
/// non-remote rows while `total_tracks` keeps counting remotes so virtual
/// scroll can still paginate them.
#[test]
fn test_get_section_all_separates_remote_from_local_count() {
    let db = sample_db();
    add_track(&db, 1, 60.0);
    add_track(&db, 2, 60.0);
    let conn = db.conn().unwrap();
    let metadata = TrackMetadata {
        title: Some("Streamed".to_string()),
        artist: Some("Remote".to_string()),
        duration: Some(90.0),
        file_size: Some(4_000_000),
        ..Default::default()
    };
    let remote = library::add_track(&conn, "https://plex/stream.m4a", &metadata).unwrap();
    mark_remote(&conn, remote, "plex:1");
    drop(conn);

    let resp = get_section(
        &db,
        "all".into(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(resp.total_tracks, 3, "remotes count for pagination");
    assert_eq!(
        resp.local_file_count, 2,
        "remotes are excluded from the footer"
    );
    // Local-only duration: the streamed track's 90s stays out of the total.
    assert_eq!(resp.total_duration, 120.0);
}

#[test]
fn test_get_section_unknown_section_error_names_it() {
    let db = sample_db();
    let err = get_section(
        &db,
        "bogus".into(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap_err();
    // `DbError::NotFound`'s Display prefix is part of what the frontend has
    // always received, so it has to survive the move.
    assert_eq!(err, "Record not found: Unknown section: bogus");
}

#[test]
fn test_get_section_invalid_playlist_id_error_names_it() {
    let db = sample_db();
    let err = get_section(
        &db,
        "playlist-not-a-number".into(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap_err();
    assert_eq!(err, "Record not found: Invalid playlist id: not-a-number");
}

#[test]
fn test_get_section_missing_playlist_error_names_it() {
    let db = sample_db();
    let err = get_section(
        &db,
        "playlist-77".into(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap_err();
    assert_eq!(err, "Record not found: Playlist 77 not found");
}

/// Every section shares one response shape; the sections that are not
/// paginated report no page and no `has_more`.
#[test]
fn test_get_section_non_paginated_sections_omit_page() {
    let db = sample_db();
    let id = add_track(&db, 1, 60.0);
    let conn = db.conn().unwrap();
    favorites::add_favorite(&conn, id).unwrap();
    drop(conn);

    for section in ["liked", "top25", "recent", "added"] {
        let resp = get_section(
            &db,
            section.into(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(resp.section, section);
        assert_eq!(resp.page, None, "{section} must not report a page");
        assert_eq!(
            resp.page_size, None,
            "{section} must not report a page size"
        );
        assert!(!resp.has_more, "{section} must not claim more rows");
        // Non-"all" sections set local_file_count equal to their own total.
        assert_eq!(resp.local_file_count, resp.total_tracks, "{section} totals");
    }
}

/// `days` and `limit` are clamped rather than rejected, so a bad settings
/// value cannot make "recent" return nothing or the whole library.
#[test]
fn test_get_section_clamps_days_and_limit() {
    let db = sample_db();
    let id = add_track(&db, 1, 60.0);
    let conn = db.conn().unwrap();
    library::update_play_count(&conn, id).unwrap();
    drop(conn);

    let clamped = get_section(
        &db,
        "recent".into(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(-5),
    )
    .unwrap();
    assert_eq!(
        clamped.total_tracks, 1,
        "days < 1 clamps to 1, not to zero rows"
    );

    let too_many = get_section(
        &db,
        "recent".into(),
        None,
        None,
        None,
        None,
        None,
        Some(10_000),
        None,
        None,
        Some(9999),
    )
    .unwrap();
    assert_eq!(too_many.total_tracks, 1);
}

/// The revision comes from the same transaction as the rows, so a caller can
/// treat it as a cache key for exactly this response.
#[test]
fn test_get_section_revision_reflects_committed_writes() {
    let db = sample_db();
    let before = get_section(
        &db,
        "all".into(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap()
    .revision;

    add_track(&db, 1, 60.0);

    let after = get_section(
        &db,
        "all".into(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap()
    .revision;
    assert!(after > before, "adding a track must advance the revision");
}
