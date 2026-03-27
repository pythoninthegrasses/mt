//! Stats aggregate SQL queries for listening statistics.

use rusqlite::Connection;

use super::DbResult;
use super::models::{
    ArtistPlayCount, GenreBreakdown, ListeningStats, PlaysOverTime, StatsDateRange,
};

/// Album entry for chart grid generation
#[derive(Debug, Clone)]
#[allow(dead_code)] // Fields used in chart grid command and tests
pub(crate) struct AlbumGridEntry {
    pub track_id: i64,
    pub filepath: String,
    pub album: String,
    pub artist: String,
}

/// Build a WHERE clause fragment for filtering play_history by date range.
/// Returns (clause, optional param value).
fn range_clause(range: &StatsDateRange) -> (&'static str, Option<i64>) {
    match range {
        StatsDateRange::AllTime => ("", None),
        StatsDateRange::Last7Days => {
            let cutoff = chrono::Utc::now().timestamp() - 7 * 86400;
            ("AND ph.played_at >= ?", Some(cutoff))
        }
        StatsDateRange::Last30Days => {
            let cutoff = chrono::Utc::now().timestamp() - 30 * 86400;
            ("AND ph.played_at >= ?", Some(cutoff))
        }
        StatsDateRange::Last90Days => {
            let cutoff = chrono::Utc::now().timestamp() - 90 * 86400;
            ("AND ph.played_at >= ?", Some(cutoff))
        }
        StatsDateRange::Last180Days => {
            let cutoff = chrono::Utc::now().timestamp() - 180 * 86400;
            ("AND ph.played_at >= ?", Some(cutoff))
        }
        StatsDateRange::Last365Days => {
            let cutoff = chrono::Utc::now().timestamp() - 365 * 86400;
            ("AND ph.played_at >= ?", Some(cutoff))
        }
    }
}

/// Get overall listening statistics for a date range
pub(crate) fn get_listening_stats(
    conn: &Connection,
    range: &StatsDateRange,
) -> DbResult<ListeningStats> {
    let (range_where, range_param) = range_clause(range);

    let sql = format!(
        "SELECT
            COUNT(*) as total_plays,
            COUNT(DISTINCT ph.track_id) as total_tracks_played,
            COUNT(DISTINCT COALESCE(NULLIF(l.album_artist, ''), l.artist)) as total_artists_played,
            COALESCE(SUM(COALESCE(l.duration, 0)), 0) as total_listening_time
         FROM play_history ph
         JOIN library l ON l.id = ph.track_id
         WHERE 1=1 {range_where}"
    );

    if let Some(param) = range_param {
        conn.query_row(&sql, [param], |row| {
            Ok(ListeningStats {
                total_plays: row.get(0)?,
                total_tracks_played: row.get(1)?,
                total_artists_played: row.get(2)?,
                total_listening_time: row.get::<_, f64>(3).map(|v| v as i64)?,
            })
        })
        .map_err(Into::into)
    } else {
        conn.query_row(&sql, [], |row| {
            Ok(ListeningStats {
                total_plays: row.get(0)?,
                total_tracks_played: row.get(1)?,
                total_artists_played: row.get(2)?,
                total_listening_time: row.get::<_, f64>(3).map(|v| v as i64)?,
            })
        })
        .map_err(Into::into)
    }
}

/// Get top artists by play count
pub(crate) fn get_top_artists(
    conn: &Connection,
    range: &StatsDateRange,
    limit: i64,
) -> DbResult<Vec<ArtistPlayCount>> {
    let (range_where, range_param) = range_clause(range);

    let sql = format!(
        "SELECT
            COALESCE(NULLIF(l.album_artist, ''), l.artist) as artist_name,
            COUNT(*) as play_count,
            MIN(l.id) as track_id
         FROM play_history ph
         JOIN library l ON l.id = ph.track_id
         WHERE l.artist IS NOT NULL {range_where}
         GROUP BY artist_name
         ORDER BY play_count DESC
         LIMIT ?"
    );

    let mut stmt = conn.prepare(&sql)?;

    let rows = if let Some(param) = range_param {
        stmt.query_map([param, limit], |row| {
            Ok(ArtistPlayCount {
                artist: row.get(0)?,
                play_count: row.get(1)?,
                track_id: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map([limit], |row| {
            Ok(ArtistPlayCount {
                artist: row.get(0)?,
                play_count: row.get(1)?,
                track_id: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    };

    Ok(rows)
}

/// Get genre breakdown by play count
pub(crate) fn get_genre_breakdown(
    conn: &Connection,
    range: &StatsDateRange,
    limit: i64,
) -> DbResult<Vec<GenreBreakdown>> {
    let (range_where, range_param) = range_clause(range);

    let sql = format!(
        "SELECT
            l.genre,
            COUNT(*) as play_count,
            COUNT(DISTINCT ph.track_id) as track_count
         FROM play_history ph
         JOIN library l ON l.id = ph.track_id
         WHERE l.genre IS NOT NULL AND l.genre != '' {range_where}
         GROUP BY l.genre
         ORDER BY play_count DESC
         LIMIT ?"
    );

    let mut stmt = conn.prepare(&sql)?;

    let rows = if let Some(param) = range_param {
        stmt.query_map([param, limit], |row| {
            Ok(GenreBreakdown {
                genre: row.get(0)?,
                play_count: row.get(1)?,
                track_count: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map([limit], |row| {
            Ok(GenreBreakdown {
                genre: row.get(0)?,
                play_count: row.get(1)?,
                track_count: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    };

    Ok(rows)
}

/// Get plays over time grouped by year (AllTime) or day (ranged)
pub(crate) fn get_plays_over_time(
    conn: &Connection,
    range: &StatsDateRange,
) -> DbResult<Vec<PlaysOverTime>> {
    let (range_where, range_param) = range_clause(range);

    let group_expr = match range {
        StatsDateRange::AllTime => "strftime('%Y', played_at, 'unixepoch')",
        StatsDateRange::Last7Days | StatsDateRange::Last30Days => {
            "strftime('%Y-%m-%d', played_at, 'unixepoch')"
        }
        _ => "strftime('%Y-%m', played_at, 'unixepoch')",
    };

    let sql = format!(
        "SELECT
            {group_expr} as label,
            COUNT(*) as count
         FROM play_history ph
         WHERE 1=1 {range_where}
         GROUP BY label
         ORDER BY label ASC"
    );

    let mut stmt = conn.prepare(&sql)?;

    let rows = if let Some(param) = range_param {
        stmt.query_map([param], |row| {
            Ok(PlaysOverTime {
                label: row.get(0)?,
                count: row.get(1)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map([], |row| {
            Ok(PlaysOverTime {
                label: row.get(0)?,
                count: row.get(1)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    };

    Ok(rows)
}

/// Get top albums for chart grid generation
pub(crate) fn get_top_albums_for_grid(
    conn: &Connection,
    range: &StatsDateRange,
    sort_by: &str,
    limit: i64,
) -> DbResult<Vec<AlbumGridEntry>> {
    let (range_where, range_param) = range_clause(range);

    let order = match sort_by {
        "play_count" => "play_count DESC",
        "album" => "album_name ASC",
        "artist" => "artist_name ASC",
        _ => "play_count DESC",
    };

    let sql = format!(
        "SELECT
            MIN(l.id) as track_id,
            MIN(l.filepath) as filepath,
            COALESCE(l.album, 'Unknown Album') as album_name,
            COALESCE(NULLIF(l.album_artist, ''), l.artist, 'Unknown Artist') as artist_name,
            COUNT(*) as play_count
         FROM play_history ph
         JOIN library l ON l.id = ph.track_id
         WHERE l.album IS NOT NULL AND l.album != '' {range_where}
         GROUP BY album_name, artist_name
         ORDER BY {order}
         LIMIT ?"
    );

    let mut stmt = conn.prepare(&sql)?;

    let rows = if let Some(param) = range_param {
        stmt.query_map([param, limit], |row| {
            Ok(AlbumGridEntry {
                track_id: row.get(0)?,
                filepath: row.get(1)?,
                album: row.get(2)?,
                artist: row.get(3)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map([limit], |row| {
            Ok(AlbumGridEntry {
                track_id: row.get(0)?,
                filepath: row.get(1)?,
                album: row.get(2)?,
                artist: row.get(3)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    };

    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::TrackMetadata;
    use crate::db::library::{add_track, update_play_count};
    use crate::db::register_custom_functions;
    use crate::db::schema::{create_tables, run_migrations};

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        register_custom_functions(&conn).unwrap();
        create_tables(&conn).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    /// Helper: add a track and play it N times
    fn add_and_play(conn: &Connection, filepath: &str, meta: &TrackMetadata, plays: usize) -> i64 {
        let id = add_track(conn, filepath, meta).unwrap();
        for _ in 0..plays {
            update_play_count(conn, id).unwrap();
        }
        id
    }

    #[test]
    fn test_listening_stats_empty() {
        let conn = setup_test_db();
        let stats = get_listening_stats(&conn, &StatsDateRange::AllTime).unwrap();
        assert_eq!(stats.total_plays, 0);
        assert_eq!(stats.total_tracks_played, 0);
        assert_eq!(stats.total_artists_played, 0);
        assert_eq!(stats.total_listening_time, 0);
    }

    #[test]
    fn test_listening_stats_with_plays() {
        let conn = setup_test_db();

        add_and_play(
            &conn,
            "/music/a.mp3",
            &TrackMetadata {
                title: Some("Song A".into()),
                artist: Some("Artist 1".into()),
                duration: Some(200.0),
                ..Default::default()
            },
            3,
        );
        add_and_play(
            &conn,
            "/music/b.mp3",
            &TrackMetadata {
                title: Some("Song B".into()),
                artist: Some("Artist 2".into()),
                duration: Some(300.0),
                ..Default::default()
            },
            2,
        );

        let stats = get_listening_stats(&conn, &StatsDateRange::AllTime).unwrap();
        assert_eq!(stats.total_plays, 5);
        assert_eq!(stats.total_tracks_played, 2);
        assert_eq!(stats.total_artists_played, 2);
        // 3 * 200 + 2 * 300 = 1200
        assert_eq!(stats.total_listening_time, 1200);
    }

    #[test]
    fn test_listening_stats_7d_range() {
        let conn = setup_test_db();

        // Add a track and play it (plays are all "now" so within 7 days)
        add_and_play(
            &conn,
            "/music/recent.mp3",
            &TrackMetadata {
                title: Some("Recent".into()),
                artist: Some("Artist".into()),
                duration: Some(100.0),
                ..Default::default()
            },
            2,
        );

        // Insert an old play manually (30 days ago)
        let old_time = chrono::Utc::now().timestamp() - 30 * 86400;
        let id = add_track(
            &conn,
            "/music/old.mp3",
            &TrackMetadata {
                title: Some("Old".into()),
                artist: Some("Old Artist".into()),
                duration: Some(150.0),
                ..Default::default()
            },
        )
        .unwrap();
        conn.execute(
            "INSERT INTO play_history (track_id, played_at) VALUES (?, ?)",
            rusqlite::params![id, old_time],
        )
        .unwrap();

        let stats_7d = get_listening_stats(&conn, &StatsDateRange::Last7Days).unwrap();
        assert_eq!(stats_7d.total_plays, 2); // Only recent plays
        assert_eq!(stats_7d.total_tracks_played, 1);

        let stats_all = get_listening_stats(&conn, &StatsDateRange::AllTime).unwrap();
        assert_eq!(stats_all.total_plays, 3); // All plays
    }

    #[test]
    fn test_top_artists_ordering() {
        let conn = setup_test_db();

        add_and_play(
            &conn,
            "/music/a.mp3",
            &TrackMetadata {
                artist: Some("Less Popular".into()),
                ..Default::default()
            },
            2,
        );
        add_and_play(
            &conn,
            "/music/b.mp3",
            &TrackMetadata {
                artist: Some("Most Popular".into()),
                ..Default::default()
            },
            5,
        );
        add_and_play(
            &conn,
            "/music/c.mp3",
            &TrackMetadata {
                artist: Some("Mid Popular".into()),
                ..Default::default()
            },
            3,
        );

        let artists = get_top_artists(&conn, &StatsDateRange::AllTime, 10).unwrap();
        assert_eq!(artists.len(), 3);
        assert_eq!(artists[0].artist, "Most Popular");
        assert_eq!(artists[0].play_count, 5);
        assert_eq!(artists[1].artist, "Mid Popular");
        assert_eq!(artists[1].play_count, 3);
        assert_eq!(artists[2].artist, "Less Popular");
        assert_eq!(artists[2].play_count, 2);
    }

    #[test]
    fn test_top_artists_limit() {
        let conn = setup_test_db();

        for i in 0..5 {
            add_and_play(
                &conn,
                &format!("/music/{i}.mp3"),
                &TrackMetadata {
                    artist: Some(format!("Artist {i}")),
                    ..Default::default()
                },
                i + 1,
            );
        }

        let artists = get_top_artists(&conn, &StatsDateRange::AllTime, 3).unwrap();
        assert_eq!(artists.len(), 3);
    }

    #[test]
    fn test_top_artists_includes_track_id() {
        let conn = setup_test_db();

        let id = add_and_play(
            &conn,
            "/music/track.mp3",
            &TrackMetadata {
                artist: Some("Test Artist".into()),
                ..Default::default()
            },
            1,
        );

        let artists = get_top_artists(&conn, &StatsDateRange::AllTime, 10).unwrap();
        assert_eq!(artists.len(), 1);
        assert_eq!(artists[0].track_id, Some(id));
    }

    #[test]
    fn test_top_artists_uses_album_artist() {
        let conn = setup_test_db();

        // Track with album_artist should group by album_artist
        add_and_play(
            &conn,
            "/music/a.mp3",
            &TrackMetadata {
                artist: Some("Featured Artist".into()),
                album_artist: Some("Main Artist".into()),
                ..Default::default()
            },
            3,
        );

        let artists = get_top_artists(&conn, &StatsDateRange::AllTime, 10).unwrap();
        assert_eq!(artists.len(), 1);
        assert_eq!(artists[0].artist, "Main Artist");
    }

    #[test]
    fn test_genre_breakdown_counts() {
        let conn = setup_test_db();

        add_and_play(
            &conn,
            "/music/rock1.mp3",
            &TrackMetadata {
                genre: Some("Rock".into()),
                ..Default::default()
            },
            3,
        );
        add_and_play(
            &conn,
            "/music/rock2.mp3",
            &TrackMetadata {
                genre: Some("Rock".into()),
                ..Default::default()
            },
            2,
        );
        add_and_play(
            &conn,
            "/music/jazz1.mp3",
            &TrackMetadata {
                genre: Some("Jazz".into()),
                ..Default::default()
            },
            1,
        );

        let genres = get_genre_breakdown(&conn, &StatsDateRange::AllTime, 10).unwrap();
        assert_eq!(genres.len(), 2);
        assert_eq!(genres[0].genre, "Rock");
        assert_eq!(genres[0].play_count, 5); // 3 + 2
        assert_eq!(genres[0].track_count, 2);
        assert_eq!(genres[1].genre, "Jazz");
        assert_eq!(genres[1].play_count, 1);
        assert_eq!(genres[1].track_count, 1);
    }

    #[test]
    fn test_genre_breakdown_excludes_null() {
        let conn = setup_test_db();

        add_and_play(
            &conn,
            "/music/no_genre.mp3",
            &TrackMetadata {
                genre: None,
                ..Default::default()
            },
            5,
        );
        add_and_play(
            &conn,
            "/music/with_genre.mp3",
            &TrackMetadata {
                genre: Some("Pop".into()),
                ..Default::default()
            },
            1,
        );

        let genres = get_genre_breakdown(&conn, &StatsDateRange::AllTime, 10).unwrap();
        assert_eq!(genres.len(), 1);
        assert_eq!(genres[0].genre, "Pop");
    }

    #[test]
    fn test_plays_over_time_year_grouping() {
        let conn = setup_test_db();

        // Insert plays at specific timestamps for different years
        let id = add_track(
            &conn,
            "/music/test.mp3",
            &TrackMetadata {
                artist: Some("Test".into()),
                ..Default::default()
            },
        )
        .unwrap();

        // 2024-06-15 = 1718409600
        conn.execute(
            "INSERT INTO play_history (track_id, played_at) VALUES (?, 1718409600)",
            [id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO play_history (track_id, played_at) VALUES (?, 1718409601)",
            [id],
        )
        .unwrap();

        // 2023-01-15 = 1673740800
        conn.execute(
            "INSERT INTO play_history (track_id, played_at) VALUES (?, 1673740800)",
            [id],
        )
        .unwrap();

        let plays = get_plays_over_time(&conn, &StatsDateRange::AllTime).unwrap();
        assert_eq!(plays.len(), 2);
        assert_eq!(plays[0].label, "2023");
        assert_eq!(plays[0].count, 1);
        assert_eq!(plays[1].label, "2024");
        assert_eq!(plays[1].count, 2);
    }

    #[test]
    fn test_plays_over_time_day_grouping() {
        let conn = setup_test_db();

        // Add plays via update_play_count (all will be "today")
        add_and_play(
            &conn,
            "/music/test.mp3",
            &TrackMetadata {
                artist: Some("Test".into()),
                ..Default::default()
            },
            3,
        );

        let plays = get_plays_over_time(&conn, &StatsDateRange::Last7Days).unwrap();
        assert_eq!(plays.len(), 1);
        assert_eq!(plays[0].count, 3);
        // Label should be today's date in YYYY-MM-DD format
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        assert_eq!(plays[0].label, today);
    }

    #[test]
    fn test_top_albums_for_grid() {
        let conn = setup_test_db();

        add_and_play(
            &conn,
            "/music/album1/track.mp3",
            &TrackMetadata {
                album: Some("Album One".into()),
                artist: Some("Artist A".into()),
                ..Default::default()
            },
            5,
        );
        add_and_play(
            &conn,
            "/music/album2/track.mp3",
            &TrackMetadata {
                album: Some("Album Two".into()),
                artist: Some("Artist B".into()),
                ..Default::default()
            },
            3,
        );

        let albums =
            get_top_albums_for_grid(&conn, &StatsDateRange::AllTime, "play_count", 10).unwrap();
        assert_eq!(albums.len(), 2);
        assert_eq!(albums[0].album, "Album One");
        assert_eq!(albums[1].album, "Album Two");
    }

    #[test]
    fn test_top_albums_fewer_than_cells() {
        let conn = setup_test_db();

        add_and_play(
            &conn,
            "/music/only.mp3",
            &TrackMetadata {
                album: Some("Only Album".into()),
                artist: Some("Artist".into()),
                ..Default::default()
            },
            1,
        );

        // Request 9 cells but only 1 album
        let albums =
            get_top_albums_for_grid(&conn, &StatsDateRange::AllTime, "play_count", 9).unwrap();
        assert_eq!(albums.len(), 1);
    }
}
