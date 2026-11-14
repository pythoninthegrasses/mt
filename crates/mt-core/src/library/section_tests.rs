//! Tests for the section view models, driven through the `get_section_*`
//! helpers on a borrowed connection — the shape the desktop adapter calls.
//!
//! These came across with the code from `mt-tauri`. The public
//! [`super::get_section`] entry point, whose error strings the frontend
//! displays, is covered in [`dispatch_tests`].

use super::*;
use crate::db::{TrackMetadata, favorites, library, playlists, revision};
use crate::library::test_util::{add_conn_track, setup_conn};

#[test]
fn test_section_all_empty() {
    let conn = setup_conn();
    let rev = revision::get_revision(&conn).unwrap();
    let resp = get_section_all(&conn, rev, None, None, None, None, None, None, None, None).unwrap();
    assert_eq!(resp.section, "all");
    assert_eq!(resp.total_tracks, 0);
    assert_eq!(resp.total_duration, 0.0);
    assert!(!resp.has_more);
    assert!(resp.tracks.is_empty());
    assert_eq!(resp.revision, 0);
}

#[test]
fn test_section_all_with_tracks() {
    let conn = setup_conn();
    for i in 1..=5 {
        add_conn_track(&conn, i, 100.0 * i as f64);
    }
    let rev = revision::get_revision(&conn).unwrap();
    let resp = get_section_all(&conn, rev, None, None, None, None, None, None, None, None).unwrap();
    assert_eq!(resp.total_tracks, 5);
    assert_eq!(resp.total_duration, 100.0 + 200.0 + 300.0 + 400.0 + 500.0);
    assert_eq!(resp.tracks.len(), 5);
    assert!(!resp.has_more);
}

#[test]
fn test_section_all_pagination() {
    let conn = setup_conn();
    for i in 1..=10 {
        add_conn_track(&conn, i, 60.0);
    }
    let rev = revision::get_revision(&conn).unwrap();
    let resp = get_section_all(
        &conn,
        rev,
        None,
        None,
        None,
        None,
        None,
        Some(3),
        Some(0),
        None,
    )
    .unwrap();
    assert_eq!(resp.tracks.len(), 3);
    assert_eq!(resp.total_tracks, 10);
    assert!(resp.has_more);
    assert_eq!(resp.page, Some(0));
    assert_eq!(resp.page_size, Some(3));
}

// Stats-only request: limit=0 means "return totals without any tracks".
// The frontend page cache uses this to confirm a cached page 0 is still
// valid while avoiding the cost of re-fetching the full first page.
// Pre-fix this panicked with division-by-zero on `page_offset / page_size`.
#[test]
fn test_section_all_stats_only_limit_zero() {
    let conn = setup_conn();
    for i in 1..=10 {
        add_conn_track(&conn, i, 60.0);
    }
    let rev = revision::get_revision(&conn).unwrap();
    let resp = get_section_all(
        &conn,
        rev,
        None,
        None,
        None,
        None,
        None,
        Some(0),
        Some(0),
        None,
    )
    .unwrap();
    assert!(resp.tracks.is_empty(), "stats-only must return no tracks");
    assert_eq!(resp.total_tracks, 10);
    assert_eq!(resp.total_duration, 60.0 * 10.0);
    assert_eq!(resp.page_size, Some(0));
    assert_eq!(resp.page, None);
    assert!(resp.has_more, "has_more=true when rows exist");
}

#[test]
fn test_section_all_stats_only_empty_db() {
    let conn = setup_conn();
    let rev = revision::get_revision(&conn).unwrap();
    let resp = get_section_all(
        &conn,
        rev,
        None,
        None,
        None,
        None,
        None,
        Some(0),
        Some(0),
        None,
    )
    .unwrap();
    assert!(resp.tracks.is_empty());
    assert_eq!(resp.total_tracks, 0);
    assert!(!resp.has_more, "has_more=false when no rows exist");
}

#[test]
fn test_section_all_beyond_last_page() {
    let conn = setup_conn();
    for i in 1..=5 {
        add_conn_track(&conn, i, 60.0);
    }
    let rev = revision::get_revision(&conn).unwrap();
    let resp = get_section_all(
        &conn,
        rev,
        None,
        None,
        None,
        None,
        None,
        Some(10),
        Some(100),
        None,
    )
    .unwrap();
    assert!(resp.tracks.is_empty());
    assert_eq!(resp.total_tracks, 5);
    assert!(!resp.has_more);
}

#[test]
fn test_section_all_search() {
    let conn = setup_conn();
    add_conn_track(&conn, 1, 60.0);
    let metadata = TrackMetadata {
        title: Some("Unique Song".to_string()),
        artist: Some("Special Artist".to_string()),
        duration: Some(120.0),
        ..Default::default()
    };
    library::add_track(&conn, "/music/unique.mp3", &metadata).unwrap();

    let rev = revision::get_revision(&conn).unwrap();
    let resp = get_section_all(
        &conn,
        rev,
        Some("Unique".to_string()),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(resp.total_tracks, 1);
    assert_eq!(resp.tracks.len(), 1);
    assert_eq!(resp.tracks[0].title, Some("Unique Song".to_string()));
}

#[test]
fn test_section_liked() {
    let conn = setup_conn();
    let id1 = add_conn_track(&conn, 1, 100.0);
    let id2 = add_conn_track(&conn, 2, 200.0);
    add_conn_track(&conn, 3, 300.0); // not favorited

    favorites::add_favorite(&conn, id1).unwrap();
    favorites::add_favorite(&conn, id2).unwrap();

    let rev = revision::get_revision(&conn).unwrap();
    let resp = get_section_liked(&conn, rev, None, None).unwrap();
    assert_eq!(resp.section, "liked");
    assert_eq!(resp.total_tracks, 2);
    assert_eq!(resp.total_duration, 300.0);
    assert_eq!(resp.tracks.len(), 2);
    assert!(!resp.has_more);
}

#[test]
fn test_section_top25() {
    let conn = setup_conn();
    let id1 = add_conn_track(&conn, 1, 150.0);
    let id2 = add_conn_track(&conn, 2, 250.0);

    for _ in 0..5 {
        library::update_play_count(&conn, id1).unwrap();
    }
    for _ in 0..10 {
        library::update_play_count(&conn, id2).unwrap();
    }

    let rev = revision::get_revision(&conn).unwrap();
    let resp = get_section_top25(&conn, rev).unwrap();
    assert_eq!(resp.section, "top25");
    assert_eq!(resp.total_tracks, 2);
    assert_eq!(resp.total_duration, 400.0);
    // Most played first
    assert_eq!(resp.tracks[0].play_count, 10);
    assert_eq!(resp.tracks[1].play_count, 5);
}

#[test]
fn test_section_recent() {
    let conn = setup_conn();
    let id = add_conn_track(&conn, 1, 180.0);
    library::update_play_count(&conn, id).unwrap();

    let rev = revision::get_revision(&conn).unwrap();
    let resp = get_section_recent(&conn, rev, Some(7), Some(100)).unwrap();
    assert_eq!(resp.section, "recent");
    assert_eq!(resp.total_tracks, 1);
    assert_eq!(resp.total_duration, 180.0);
}

#[test]
fn test_section_added() {
    let conn = setup_conn();
    add_conn_track(&conn, 1, 200.0);
    add_conn_track(&conn, 2, 300.0);

    let rev = revision::get_revision(&conn).unwrap();
    let resp = get_section_added(&conn, rev, Some(7), Some(100)).unwrap();
    assert_eq!(resp.section, "added");
    assert_eq!(resp.total_tracks, 2);
    assert_eq!(resp.total_duration, 500.0);
}

#[test]
fn test_section_playlist() {
    let conn = setup_conn();
    let id1 = add_conn_track(&conn, 1, 100.0);
    let id2 = add_conn_track(&conn, 2, 200.0);

    let playlist = playlists::create_playlist(&conn, "Test Playlist")
        .unwrap()
        .unwrap();
    playlists::add_tracks_to_playlist(&conn, playlist.id, &[id1, id2], None).unwrap();

    let rev = revision::get_revision(&conn).unwrap();
    let resp = get_section_playlist(&conn, rev, playlist.id).unwrap();
    assert_eq!(resp.section, format!("playlist-{}", playlist.id));
    assert_eq!(resp.total_tracks, 2);
    assert_eq!(resp.total_duration, 300.0);
    assert_eq!(resp.tracks.len(), 2);
}

#[test]
fn test_section_playlist_not_found() {
    let conn = setup_conn();
    let rev = revision::get_revision(&conn).unwrap();
    let result = get_section_playlist(&conn, rev, 999);
    assert!(result.is_err());
}

#[test]
fn test_section_unknown() {
    let _conn = setup_conn();
    // We can't directly test the match arm since it's inside the command,
    // but the DB-level helpers cover each section type. This tests the
    // response struct serialization for completeness.
    let resp = LibrarySectionResponse {
        section: "all".to_string(),
        tracks: vec![],
        total_tracks: 0,
        total_duration: 0.0,
        total_size: 0,
        local_file_count: 0,
        page: None,
        page_size: None,
        has_more: false,
        revision: 0,
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("\"section\":\"all\""));
    assert!(json.contains("\"revision\":0"));
    assert!(json.contains("\"has_more\":false"));
}

#[test]
fn test_revision_increments_on_add() {
    let conn = setup_conn();
    let rev_before = revision::get_revision(&conn).unwrap();
    assert_eq!(rev_before, 0);

    // Bump revision (simulating what add_track will do after Phase 4)
    revision::bump_revision(&conn).unwrap();

    let rev_after = revision::get_revision(&conn).unwrap();
    assert_eq!(rev_after, 1);
}

#[test]
fn test_section_all_sort() {
    let conn = setup_conn();
    let metadata_a = TrackMetadata {
        title: Some("Alpha".to_string()),
        artist: Some("Zeta".to_string()),
        duration: Some(60.0),
        ..Default::default()
    };
    library::add_track(&conn, "/music/alpha.mp3", &metadata_a).unwrap();

    let metadata_b = TrackMetadata {
        title: Some("Beta".to_string()),
        artist: Some("Alpha".to_string()),
        duration: Some(120.0),
        ..Default::default()
    };
    library::add_track(&conn, "/music/beta.mp3", &metadata_b).unwrap();

    let rev = revision::get_revision(&conn).unwrap();
    let resp = get_section_all(
        &conn,
        rev,
        None,
        None,
        None,
        Some("title".to_string()),
        Some("asc".to_string()),
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(resp.tracks[0].title, Some("Alpha".to_string()));
    assert_eq!(resp.tracks[1].title, Some("Beta".to_string()));
}
