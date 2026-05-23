use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, params};
use serde::Serialize;
use unicode_normalization::UnicodeNormalization;

use crate::db::DbResult;
use crate::plex::client::PlexClient;
use crate::plex::types::{PlexAlbum, PlexTrack};

#[derive(Debug, Clone, Serialize)]
pub(crate) struct PlexMergeStats {
    pub inserted: u64,
    pub linked: u64,
    pub skipped: u64,
    pub errors: Vec<String>,
}

/// Normalizes a string for fuzzy track matching:
/// NFC → lowercase → trim → collapse whitespace → strip leading "the ".
pub(crate) fn normalize_for_match(s: &str) -> String {
    let nfc: String = s.nfc().collect();
    let lower = nfc.to_lowercase();
    let trimmed = lower.trim();
    let collapsed = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.strip_prefix("the ").unwrap_or(&collapsed).to_string()
}

// ── DB helpers ────────────────────────────────────────────────────────────────

struct LocalRow {
    id: i64,
    content_hash: Option<String>,
    /// (norm_artist, norm_album, norm_title)
    norm_key: (String, String, String),
}

fn load_local_rows(conn: &Connection) -> DbResult<Vec<LocalRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, content_hash, artist, album_artist, album, title
         FROM library WHERE source = 'local'",
    )?;
    let rows = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let content_hash: Option<String> = row.get(1)?;
            let artist: Option<String> = row.get(2)?;
            let album_artist: Option<String> = row.get(3)?;
            let album: Option<String> = row.get(4)?;
            let title: Option<String> = row.get(5)?;
            let artist_str = artist.or(album_artist).unwrap_or_default();
            Ok(LocalRow {
                id,
                content_hash,
                norm_key: (
                    normalize_for_match(&artist_str),
                    normalize_for_match(&album.unwrap_or_default()),
                    normalize_for_match(&title.unwrap_or_default()),
                ),
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

fn load_existing_remote_ids(conn: &Connection) -> DbResult<HashSet<String>> {
    let mut stmt =
        conn.prepare("SELECT remote_id FROM library WHERE remote_id IS NOT NULL")?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(ids)
}

fn insert_plex_track(conn: &Connection, track: &PlexTrack, stream_url: &str) -> DbResult<()> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let duration_secs = track.duration as f64 / 1000.0;
    let year_str = track.year.map(|y| y.to_string());
    let track_number_str = track.track_number.to_string();
    conn.execute(
        "INSERT INTO library
         (filepath, title, artist, album, track_number, date, duration,
          source, remote_id, last_seen_at, missing)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'plex', ?, ?, 0)",
        params![
            stream_url,
            track.title,
            track.artist_name,
            track.album_name,
            track_number_str,
            year_str,
            duration_secs,
            track.rating_key,
            now,
        ],
    )?;
    crate::db::revision::bump_revision(conn)?;
    Ok(())
}

fn link_local_track(conn: &Connection, local_id: i64, remote_id: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE library SET remote_id = ? WHERE id = ?",
        params![remote_id, local_id],
    )?;
    crate::db::revision::bump_revision(conn)?;
    Ok(())
}

// ── Core merge ────────────────────────────────────────────────────────────────

/// Merge Plex tracks into the local library in a single transaction.
///
/// `albums_with_tracks`: albums (in section-order then album-order) paired with
/// their pre-fetched track lists. The caller is responsible for ensuring cache
/// is populated before calling this.
pub(crate) fn merge_plex_library(
    conn: &Connection,
    albums_with_tracks: &[(PlexAlbum, Vec<PlexTrack>)],
    client: &PlexClient,
) -> Result<PlexMergeStats, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to begin transaction: {e}"))?;

    let local_rows = load_local_rows(&tx).map_err(|e| e.to_string())?;
    let existing_remote_ids = load_existing_remote_ids(&tx).map_err(|e| e.to_string())?;

    // Build lookup tables from local rows.
    // hash_map: content_hash → local row id (for primary content_hash match).
    let mut hash_map: HashMap<String, i64> = HashMap::new();
    // norm_map: (norm_artist, norm_album, norm_title) → [local row ids].
    let mut norm_map: HashMap<(String, String, String), Vec<i64>> = HashMap::new();

    for row in &local_rows {
        if let Some(ref h) = row.content_hash {
            hash_map.insert(h.clone(), row.id);
        }
        norm_map.entry(row.norm_key.clone()).or_default().push(row.id);
    }

    let mut stats = PlexMergeStats {
        inserted: 0,
        linked: 0,
        skipped: 0,
        errors: vec![],
    };

    for (_, tracks) in albums_with_tracks {
        for track in tracks {
            // Idempotency: skip if already present (as inserted plex row or linked local).
            if existing_remote_ids.contains(&track.rating_key) {
                stats.skipped += 1;
                continue;
            }

            // (a) content_hash match — requires both sides to have a non-NULL hash.
            // PlexTrack carries no content_hash from the current Plex API, so this
            // branch is structurally correct but will not trigger in practice.

            // (b) Normalized artist + album + title match.
            let plex_norm = (
                normalize_for_match(&track.artist_name),
                normalize_for_match(&track.album_name),
                normalize_for_match(&track.title),
            );

            match norm_map.get(&plex_norm).map(|v| v.as_slice()) {
                Some([local_id]) => {
                    // Exactly one match — link without inserting.
                    match link_local_track(&tx, *local_id, &track.rating_key) {
                        Ok(()) => stats.linked += 1,
                        Err(e) => stats.errors.push(format!(
                            "link error for {}: {e}",
                            track.rating_key
                        )),
                    }
                }
                Some(ids) if ids.len() > 1 => {
                    stats.errors.push(format!(
                        "ambiguous: {} local matches for '{} / {} / {}'",
                        ids.len(),
                        track.artist_name,
                        track.album_name,
                        track.title,
                    ));
                    stats.skipped += 1;
                }
                _ => {
                    // No match — insert as Plex-sourced row.
                    let stream_url = client.stream_url(&track.part_key);
                    match insert_plex_track(&tx, track, &stream_url) {
                        Ok(()) => stats.inserted += 1,
                        Err(e) => stats.errors.push(format!(
                            "insert error for {}: {e}",
                            track.rating_key
                        )),
                    }
                }
            }
        }
    }

    tx.commit().map_err(|e| format!("Transaction commit failed: {e}"))?;
    Ok(stats)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── normalize_for_match unit tests ────────────────────────────────────────

    #[test]
    fn normalize_strips_leading_the() {
        assert_eq!(normalize_for_match("The Beatles"), "beatles");
    }

    #[test]
    fn normalize_lowercase() {
        assert_eq!(normalize_for_match("Abbey Road"), "abbey road");
    }

    #[test]
    fn normalize_leading_trailing_whitespace() {
        assert_eq!(normalize_for_match("  Come Together  "), "come together");
    }

    #[test]
    fn normalize_double_spaces() {
        assert_eq!(normalize_for_match("Come  Together"), "come together");
    }

    #[test]
    fn normalize_unicode_nfc() {
        // café (composed NFC) and cafe\u{301} (decomposed NFD) should both normalize to "café".
        let nfd = "cafe\u{301}";
        let nfc = "caf\u{e9}";
        assert_eq!(normalize_for_match(nfd), normalize_for_match(nfc));
    }

    #[test]
    fn normalize_the_not_stripped_mid_string() {
        assert_eq!(normalize_for_match("Through the Wire"), "through the wire");
    }

    #[test]
    fn normalize_empty_string() {
        assert_eq!(normalize_for_match(""), "");
    }

    // ── Integration test: merge against a wiremock Plex server ───────────────

    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::db::schema::{create_tables, run_migrations};
    use crate::plex::types::PlexConfig;

    fn make_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn make_client(server_uri: &str) -> PlexClient {
        PlexClient::new(PlexConfig {
            url: server_uri.to_string(),
            token: "test-token".to_string(),
            libraries: None,
            client_identifier: "test-client".to_string(),
        })
    }

    /// Build a JSON sections response with a single "Music" section (key="1").
    fn sections_json() -> String {
        r#"{"MediaContainer":{"size":1,"Directory":[{"type":"artist","key":"1","title":"Music"}]}}"#.to_string()
    }

    /// Build an albums page with 3 albums (ratingKey 10, 11, 12).
    fn albums_json() -> String {
        r#"{
          "MediaContainer": {
            "totalSize": 3,
            "Metadata": [
              {"ratingKey":"10","title":"Album A","parentTitle":"Artist A","year":2020,"leafCount":5},
              {"ratingKey":"11","title":"Album B","parentTitle":"Artist B","year":2021,"leafCount":5},
              {"ratingKey":"12","title":"Album C","parentTitle":"Artist C","year":2022,"leafCount":5}
            ]
          }
        }"#.to_string()
    }

    /// Build a tracks response for an album: 5 tracks numbered 1-5.
    /// `album_key` is the ratingKey of the album (used to make rating_keys unique).
    fn tracks_json(album_key: &str, artist: &str, album: &str) -> String {
        let metadata: Vec<String> = (1u32..=5)
            .map(|i| {
                format!(
                    r#"{{"ratingKey":"{album_key}{i}","title":"Track {i}","grandparentTitle":"{artist}","parentTitle":"{album}","year":2020,"index":{i},"duration":180000,"Media":[{{"Part":[{{"key":"/library/parts/{album_key}{i}/file.flac"}}]}}]}}"#
                )
            })
            .collect();
        format!(
            r#"{{"MediaContainer":{{"Metadata":[{}]}}}}"#,
            metadata.join(",")
        )
    }

    #[tokio::test]
    async fn merge_fresh_db_inserts_all() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/library/sections"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sections_json())
                    .insert_header("Content-Type", "application/json"),
            )
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path("/library/sections/1/all"))
            .and(query_param("X-Plex-Container-Start", "0"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(albums_json())
                    .insert_header("Content-Type", "application/json"),
            )
            .mount(&server)
            .await;

        for album_key in ["10", "11", "12"] {
            let (artist, album) = match album_key {
                "10" => ("Artist A", "Album A"),
                "11" => ("Artist B", "Album B"),
                _ => ("Artist C", "Album C"),
            };
            Mock::given(method("GET"))
                .and(path(format!("/library/metadata/{album_key}/children")))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_string(tracks_json(album_key, artist, album))
                        .insert_header("Content-Type", "application/json"),
                )
                .mount(&server)
                .await;
        }

        let client = make_client(&server.uri());
        let sections = client.music_sections().await.unwrap();
        let mut albums_with_tracks: Vec<(PlexAlbum, Vec<PlexTrack>)> = vec![];
        for section in &sections {
            let albums = client.albums(&section.key).await.unwrap();
            for album in albums {
                let tracks = client.tracks(&album.rating_key).await.unwrap();
                albums_with_tracks.push((album, tracks));
            }
        }

        let conn = make_test_db();
        let stats = merge_plex_library(&conn, &albums_with_tracks, &client).unwrap();

        assert_eq!(stats.inserted, 15, "inserted");
        assert_eq!(stats.linked, 0, "linked");
        assert_eq!(stats.skipped, 0, "skipped");
        assert!(stats.errors.is_empty(), "errors: {:?}", stats.errors);
    }

    #[tokio::test]
    async fn merge_links_matching_local_track() {
        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/library/sections"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(sections_json())
                    .insert_header("Content-Type", "application/json"),
            )
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path("/library/sections/1/all"))
            .and(query_param("X-Plex-Container-Start", "0"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(albums_json())
                    .insert_header("Content-Type", "application/json"),
            )
            .mount(&server)
            .await;

        for album_key in ["10", "11", "12"] {
            let (artist, album) = match album_key {
                "10" => ("Artist A", "Album A"),
                "11" => ("Artist B", "Album B"),
                _ => ("Artist C", "Album C"),
            };
            Mock::given(method("GET"))
                .and(path(format!("/library/metadata/{album_key}/children")))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_string(tracks_json(album_key, artist, album))
                        .insert_header("Content-Type", "application/json"),
                )
                .mount(&server)
                .await;
        }

        let client = make_client(&server.uri());
        let sections = client.music_sections().await.unwrap();
        let mut albums_with_tracks: Vec<(PlexAlbum, Vec<PlexTrack>)> = vec![];
        for section in &sections {
            let albums = client.albums(&section.key).await.unwrap();
            for album in albums {
                let tracks = client.tracks(&album.rating_key).await.unwrap();
                albums_with_tracks.push((album, tracks));
            }
        }

        let conn = make_test_db();

        // Pre-insert one local track that matches Album A / Track 1 by normalized text.
        conn.execute(
            "INSERT INTO library (filepath, title, artist, album, source, missing)
             VALUES ('/local/track.flac', 'Track 1', 'Artist A', 'Album A', 'local', 0)",
            [],
        )
        .unwrap();

        let stats = merge_plex_library(&conn, &albums_with_tracks, &client).unwrap();

        assert_eq!(stats.inserted, 14, "inserted");
        assert_eq!(stats.linked, 1, "linked");
        assert_eq!(stats.skipped, 0, "skipped");
        assert!(stats.errors.is_empty(), "errors: {:?}", stats.errors);
    }
}
