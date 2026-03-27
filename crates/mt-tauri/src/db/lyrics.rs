//! Lyrics cache database operations.
//!
//! Stores and retrieves cached lyrics from LRCLIB, keyed by (artist, title).
//! The `lyrics` column stores a JSON string with plainLyrics and syncedLyrics.
//! A NULL lyrics value indicates a cached negative result (track has no lyrics).

use rusqlite::{Connection, params};

use crate::db::DbResult;

/// Cached lyrics data returned from the database
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct CachedLyrics {
    pub plain_lyrics: Option<String>,
    pub synced_lyrics: Option<String>,
}

/// Get cached lyrics for a track by artist and title.
/// Returns `Ok(Some(CachedLyrics))` on cache hit (including negative cache where both fields are None),
/// or `Ok(None)` on cache miss.
pub(crate) fn get_cached_lyrics(
    conn: &Connection,
    artist: &str,
    title: &str,
) -> DbResult<Option<CachedLyrics>> {
    let mut stmt =
        conn.prepare("SELECT lyrics FROM lyrics_cache WHERE artist = ?1 AND title = ?2")?;

    let result = stmt.query_row(params![artist, title], |row| {
        let lyrics_json: Option<String> = row.get("lyrics")?;
        Ok(lyrics_json)
    });

    match result {
        Ok(Some(json_str)) => {
            let cached: CachedLyrics = serde_json::from_str(&json_str).unwrap_or(CachedLyrics {
                plain_lyrics: None,
                synced_lyrics: None,
            });
            Ok(Some(cached))
        }
        // Negative cache: row exists but lyrics column is NULL
        Ok(None) => Ok(Some(CachedLyrics {
            plain_lyrics: None,
            synced_lyrics: None,
        })),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Save lyrics to the cache. Pass `None` for `lyrics` to cache a negative result.
/// Uses INSERT OR REPLACE to upsert on the UNIQUE(artist, title) constraint.
pub(crate) fn save_lyrics(
    conn: &Connection,
    artist: &str,
    title: &str,
    album: Option<&str>,
    lyrics: Option<&CachedLyrics>,
    source_url: Option<&str>,
) -> DbResult<()> {
    let lyrics_json = lyrics.map(|l| serde_json::to_string(l).unwrap());

    conn.execute(
        "INSERT OR REPLACE INTO lyrics_cache (artist, title, album, lyrics, source_url, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)",
        params![artist, title, album, lyrics_json, source_url],
    )?;

    Ok(())
}

/// Delete all cached lyrics.
pub(crate) fn clear_cache(conn: &Connection) -> DbResult<()> {
    conn.execute("DELETE FROM lyrics_cache", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn test_cache_miss_returns_none() {
        let db = Database::new_in_memory().unwrap();
        let conn = db.conn().unwrap();

        let result = get_cached_lyrics(&conn, "Nonexistent Artist", "Nonexistent Title").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_save_and_get_round_trip() {
        let db = Database::new_in_memory().unwrap();
        let conn = db.conn().unwrap();

        let lyrics = CachedLyrics {
            plain_lyrics: Some("Is this the real life?\nIs this just fantasy?".to_string()),
            synced_lyrics: Some(
                "[00:00.00] Is this the real life?\n[00:04.50] Is this just fantasy?".to_string(),
            ),
        };

        save_lyrics(
            &conn,
            "Queen",
            "Bohemian Rhapsody",
            Some("A Night at the Opera"),
            Some(&lyrics),
            Some("https://lrclib.net/api/get?track_name=Bohemian+Rhapsody"),
        )
        .unwrap();

        let cached = get_cached_lyrics(&conn, "Queen", "Bohemian Rhapsody")
            .unwrap()
            .expect("should be a cache hit");

        assert_eq!(
            cached.plain_lyrics.as_deref(),
            Some("Is this the real life?\nIs this just fantasy?")
        );
        assert_eq!(
            cached.synced_lyrics.as_deref(),
            Some("[00:00.00] Is this the real life?\n[00:04.50] Is this just fantasy?")
        );
    }

    #[test]
    fn test_negative_cache_stores_null_lyrics() {
        let db = Database::new_in_memory().unwrap();
        let conn = db.conn().unwrap();

        // Cache a negative result (track not found on LRCLIB)
        save_lyrics(&conn, "Unknown Artist", "Unknown Song", None, None, None).unwrap();

        let cached = get_cached_lyrics(&conn, "Unknown Artist", "Unknown Song")
            .unwrap()
            .expect("should be a cache hit even for negative result");

        assert!(cached.plain_lyrics.is_none());
        assert!(cached.synced_lyrics.is_none());
    }

    #[test]
    fn test_upsert_replaces_existing() {
        let db = Database::new_in_memory().unwrap();
        let conn = db.conn().unwrap();

        // First save: negative cache
        save_lyrics(&conn, "Queen", "Bohemian Rhapsody", None, None, None).unwrap();

        let cached = get_cached_lyrics(&conn, "Queen", "Bohemian Rhapsody")
            .unwrap()
            .unwrap();
        assert!(cached.plain_lyrics.is_none());

        // Second save: now with lyrics (upsert)
        let lyrics = CachedLyrics {
            plain_lyrics: Some("Is this the real life?".to_string()),
            synced_lyrics: None,
        };
        save_lyrics(
            &conn,
            "Queen",
            "Bohemian Rhapsody",
            Some("A Night at the Opera"),
            Some(&lyrics),
            None,
        )
        .unwrap();

        let cached = get_cached_lyrics(&conn, "Queen", "Bohemian Rhapsody")
            .unwrap()
            .unwrap();
        assert_eq!(
            cached.plain_lyrics.as_deref(),
            Some("Is this the real life?")
        );
    }

    #[test]
    fn test_clear_cache() {
        let db = Database::new_in_memory().unwrap();
        let conn = db.conn().unwrap();

        let lyrics = CachedLyrics {
            plain_lyrics: Some("Hello".to_string()),
            synced_lyrics: None,
        };
        save_lyrics(&conn, "Artist", "Title", None, Some(&lyrics), None).unwrap();

        assert!(
            get_cached_lyrics(&conn, "Artist", "Title")
                .unwrap()
                .is_some()
        );

        clear_cache(&conn).unwrap();

        assert!(
            get_cached_lyrics(&conn, "Artist", "Title")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn test_different_artists_same_title_are_distinct() {
        let db = Database::new_in_memory().unwrap();
        let conn = db.conn().unwrap();

        let lyrics_a = CachedLyrics {
            plain_lyrics: Some("Lyrics from Artist A".to_string()),
            synced_lyrics: None,
        };
        let lyrics_b = CachedLyrics {
            plain_lyrics: Some("Lyrics from Artist B".to_string()),
            synced_lyrics: None,
        };

        save_lyrics(&conn, "Artist A", "Same Title", None, Some(&lyrics_a), None).unwrap();
        save_lyrics(&conn, "Artist B", "Same Title", None, Some(&lyrics_b), None).unwrap();

        let cached_a = get_cached_lyrics(&conn, "Artist A", "Same Title")
            .unwrap()
            .unwrap();
        let cached_b = get_cached_lyrics(&conn, "Artist B", "Same Title")
            .unwrap()
            .unwrap();

        assert_eq!(
            cached_a.plain_lyrics.as_deref(),
            Some("Lyrics from Artist A")
        );
        assert_eq!(
            cached_b.plain_lyrics.as_deref(),
            Some("Lyrics from Artist B")
        );
    }
}
