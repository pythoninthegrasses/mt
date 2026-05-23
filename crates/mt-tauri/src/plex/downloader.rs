use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;
use tokio::io::AsyncWriteExt;
use tracing::{debug, warn};

use crate::db::{self, Database};

const MAX_TRACK_BYTES_DEFAULT: u64 = 500 * 1024 * 1024;
const PROGRESS_THROTTLE_MS: u128 = 250;
const STORE_NAME: &str = "settings.json";

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    pub track_id: i64,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<f32>,
}

#[derive(Serialize, Clone)]
pub struct DownloadFailed {
    pub track_id: i64,
    pub error: String,
}

/// Resolve a Plex stream URL to a local filesystem path, downloading if necessary.
///
/// Downloads to `~/Music/<Artist>/<Album>/<NN> - <Title>.<ext>` and updates
/// the track's `filepath` in the DB on success.
pub(crate) async fn resolve_plex_path(
    url: &str,
    track_id: i64,
    app: &AppHandle,
    db: &Database,
) -> Result<String, String> {
    let track = db
        .with_conn(|c| db::library::get_track_by_id(c, track_id))
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track {track_id} not found in library"))?;

    let ext = url_extension(url)
        .or_else(|| path_extension(&track.filepath))
        .unwrap_or_else(|| "mp3".to_string());

    let target = build_local_path(&track, &ext)?;
    let target_str = target.to_string_lossy().to_string();

    // Already downloaded — update DB opportunistically and return cached path.
    if target.exists() {
        debug!(target = %target.display(), "Plex track already cached locally");
        let _ = db.with_conn(|c| db::library::update_track_filepath(c, track_id, &target_str));
        return Ok(target_str);
    }

    let max_bytes = read_max_track_bytes(app);
    let app_ref = app.clone();

    match download_file(url, &target, max_bytes, move |downloaded, total| {
        let percent = total
            .filter(|&t| t > 0)
            .map(|t| (downloaded as f32 / t as f32) * 100.0);
        let _ = app_ref.emit(
            "plex_download_progress",
            DownloadProgress {
                track_id,
                downloaded_bytes: downloaded,
                total_bytes: total,
                percent,
            },
        );
    })
    .await
    {
        Ok(_bytes) => {
            if let Err(e) =
                db.with_conn(|c| db::library::update_track_filepath(c, track_id, &target_str))
            {
                warn!(error = %e, "Failed to update DB filepath after Plex download");
            }
            Ok(target_str)
        }
        Err(e) => {
            let _ = app.emit(
                "plex_download_failed",
                DownloadFailed {
                    track_id,
                    error: e.clone(),
                },
            );
            let _ = db.with_conn(|c| db::library::mark_track_missing(c, track_id));
            Err(e)
        }
    }
}

/// Core download logic, separated for testability.
///
/// Downloads `url` to `target`, enforcing `max_bytes`. Creates `<target>.partial`
/// during download and atomically renames it on success; deletes it on failure.
/// Calls `on_progress(downloaded_bytes, content_length)` throttled to 250 ms,
/// and once at completion with the final byte count.
pub(crate) async fn download_file(
    url: &str,
    target: &Path,
    max_bytes: u64,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<u64, String> {
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create parent directory: {e}"))?;
    }

    debug!(url = %redact_url(url), "Starting Plex track download");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {} downloading track", resp.status()));
    }

    let total_bytes = resp.content_length();

    // Reject before writing if Content-Length exceeds the cap.
    if let Some(len) = total_bytes {
        if len > max_bytes {
            return Err(format!(
                "Content-Length {len} exceeds max track size {max_bytes}"
            ));
        }
    }

    let partial = PathBuf::from(format!("{}.partial", target.to_string_lossy()));

    // Remove any leftover partial from a previous failed attempt.
    let _ = tokio::fs::remove_file(&partial).await;

    let mut file = tokio::fs::File::create(&partial)
        .await
        .map_err(|e| format!("Failed to create partial file: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut last_progress = Instant::now();
    let mut resp = resp;

    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                downloaded += chunk.len() as u64;

                if downloaded > max_bytes {
                    let _ = file.shutdown().await;
                    let _ = tokio::fs::remove_file(&partial).await;
                    return Err(format!(
                        "Downloaded {downloaded} bytes, exceeding max {max_bytes}"
                    ));
                }

                if let Err(e) = file.write_all(&chunk).await {
                    let _ = file.shutdown().await;
                    let _ = tokio::fs::remove_file(&partial).await;
                    return Err(format!("Write error: {e}"));
                }

                let now = Instant::now();
                if now.duration_since(last_progress).as_millis() >= PROGRESS_THROTTLE_MS {
                    on_progress(downloaded, total_bytes);
                    last_progress = now;
                }
            }
            Ok(None) => break,
            Err(e) => {
                let _ = file.shutdown().await;
                let _ = tokio::fs::remove_file(&partial).await;
                return Err(format!("Stream error: {e}"));
            }
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Flush error: {e}"))?;
    file.shutdown()
        .await
        .map_err(|e| format!("Shutdown error: {e}"))?;

    tokio::fs::rename(&partial, target).await.map_err(|e| {
        let _ = std::fs::remove_file(&partial);
        format!("Failed to rename partial to target: {e}")
    })?;

    // Final progress — 100 %.
    on_progress(downloaded, Some(downloaded));

    debug!(target = %target.display(), bytes = downloaded, "Plex download complete");
    Ok(downloaded)
}

// ── Path helpers ──────────────────────────────────────────────────────────────

pub(crate) fn url_extension(url: &str) -> Option<String> {
    let path_only = url.split('?').next()?;
    let ext = Path::new(path_only).extension()?.to_str()?.to_lowercase();
    if ext.is_empty() { None } else { Some(ext) }
}

fn path_extension(filepath: &str) -> Option<String> {
    let ext = Path::new(filepath).extension()?.to_str()?.to_lowercase();
    if ext.is_empty() { None } else { Some(ext) }
}

/// Sanitize a path component, replacing forbidden chars with `_` and stripping
/// trailing dots/spaces (Windows-safe).
pub(crate) fn sanitize(s: &str) -> String {
    const INVALID: &[char] = &['/', '\\', ':', '?', '*', '"', '<', '>', '|'];
    let out: String = s
        .chars()
        .map(|c| {
            if INVALID.contains(&c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    out.trim_end_matches(|c: char| c == '.' || c == ' ')
        .to_string()
}

pub(crate) fn build_local_path(track: &crate::db::Track, ext: &str) -> Result<PathBuf, String> {
    let music_root =
        dirs::audio_dir().ok_or_else(|| "Could not determine music directory".to_string())?;

    let artist = sanitize(track.artist.as_deref().unwrap_or("Unknown Artist"));
    let album = sanitize(track.album.as_deref().unwrap_or("Unknown Album"));
    let title = sanitize(track.title.as_deref().unwrap_or("Unknown Title"));

    // Track number may be "3" or "3/12"; parse the numerator.
    let track_num: u32 = track
        .track_number
        .as_deref()
        .and_then(|s| s.split('/').next())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);

    let filename = format!("{track_num:02} - {title}.{ext}");
    Ok(music_root.join(artist).join(album).join(filename))
}

fn read_max_track_bytes(app: &AppHandle) -> u64 {
    app.store(STORE_NAME)
        .ok()
        .and_then(|s| s.get("plex.max_track_bytes"))
        .and_then(|v| v.as_u64())
        .unwrap_or(MAX_TRACK_BYTES_DEFAULT)
}

/// Strip the query string from a URL for safe logging (avoids leaking tokens).
fn redact_url(url: &str) -> String {
    match url.find('?') {
        Some(pos) => url[..pos].to_string(),
        None => url.to_string(),
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    // ── Helper-function unit tests ────────────────────────────────────────────

    #[test]
    fn test_url_extension_with_query() {
        assert_eq!(
            url_extension("http://host/file.flac?X-Plex-Token=abc"),
            Some("flac".to_string())
        );
    }

    #[test]
    fn test_url_extension_uppercase_normalised() {
        assert_eq!(
            url_extension("http://host/file.MP3?token=x"),
            Some("mp3".to_string())
        );
    }

    #[test]
    fn test_url_extension_none_without_ext() {
        assert_eq!(url_extension("http://host/noext?token=x"), None);
    }

    #[test]
    fn test_sanitize_slash() {
        assert_eq!(sanitize("AC/DC"), "AC_DC");
    }

    #[test]
    fn test_sanitize_colon() {
        assert_eq!(sanitize("Track: One"), "Track_ One");
    }

    #[test]
    fn test_sanitize_trailing_dot() {
        assert_eq!(sanitize("End Dot."), "End Dot");
    }

    #[test]
    fn test_sanitize_trailing_spaces() {
        assert_eq!(sanitize("Trailing   "), "Trailing");
    }

    #[test]
    fn test_redact_url_removes_query() {
        let url = "http://plex:32400/library/parts/1/file.flac?X-Plex-Token=secret";
        let redacted = redact_url(url);
        assert_eq!(redacted, "http://plex:32400/library/parts/1/file.flac");
        assert!(!redacted.contains("secret"));
    }

    #[test]
    fn test_redact_url_no_query() {
        let url = "http://plex:32400/library/parts/1/file.flac";
        assert_eq!(redact_url(url), url);
    }

    #[test]
    fn test_build_local_path_filename_format() {
        let track = crate::db::Track {
            id: 1,
            filepath: "/plex/stream.flac".to_string(),
            title: Some("My Song".to_string()),
            artist: Some("My Artist".to_string()),
            album: Some("My Album".to_string()),
            track_number: Some("5".to_string()),
            ..Default::default()
        };
        if let Ok(p) = build_local_path(&track, "flac") {
            let fname = p.file_name().unwrap().to_str().unwrap();
            assert_eq!(fname, "05 - My Song.flac");
            let s = p.to_string_lossy();
            assert!(s.contains("My Artist"));
            assert!(s.contains("My Album"));
        }
    }

    #[test]
    fn test_build_local_path_track_number_fraction() {
        let track = crate::db::Track {
            id: 1,
            filepath: "/plex/stream.mp3".to_string(),
            title: Some("Title".to_string()),
            artist: Some("Artist".to_string()),
            album: Some("Album".to_string()),
            track_number: Some("7/12".to_string()),
            ..Default::default()
        };
        if let Ok(p) = build_local_path(&track, "mp3") {
            let fname = p.file_name().unwrap().to_str().unwrap();
            assert_eq!(fname, "07 - Title.mp3");
        }
    }

    // ── Wiremock integration tests ────────────────────────────────────────────

    /// (a) Small file with Content-Length: file is created, partial is gone.
    #[tokio::test]
    async fn test_download_file_success() {
        let server = MockServer::start().await;
        let body: Vec<u8> = vec![0u8; 10 * 1024]; // 10 KB
        let content_len = body.len() as u64;

        Mock::given(method("GET"))
            .and(path("/track.flac"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_bytes(body.clone())
                    .append_header("Content-Length", content_len.to_string()),
            )
            .mount(&server)
            .await;

        let tmpdir = TempDir::new().unwrap();
        let target = tmpdir.path().join("out.flac");
        let partial = PathBuf::from(format!("{}.partial", target.to_string_lossy()));

        let url = format!("{}/track.flac", server.uri());
        let result = download_file(&url, &target, 500 * 1024 * 1024, |_, _| {}).await;

        assert!(result.is_ok(), "Expected Ok, got {result:?}");
        assert_eq!(result.unwrap(), content_len);
        assert!(target.exists(), "Target file should exist");
        assert_eq!(
            std::fs::metadata(&target).unwrap().len(),
            content_len,
            "File size mismatch"
        );
        assert!(!partial.exists(), "Partial file should be cleaned up");
    }

    /// (b) Content-Length advertised exceeds cap → reject before writing, no partial.
    #[tokio::test]
    async fn test_download_file_rejects_oversized_content_length() {
        let server = MockServer::start().await;
        let body: Vec<u8> = vec![0u8; 200]; // tiny body

        Mock::given(method("GET"))
            .and(path("/big.flac"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_bytes(body)
                    .append_header("Content-Length", "10000000000"), // 10 GB
            )
            .mount(&server)
            .await;

        let tmpdir = TempDir::new().unwrap();
        let target = tmpdir.path().join("out.flac");
        let partial = PathBuf::from(format!("{}.partial", target.to_string_lossy()));

        let url = format!("{}/big.flac", server.uri());
        let result = download_file(&url, &target, 1000, |_, _| {}).await;

        assert!(result.is_err(), "Expected Err for oversized Content-Length");
        assert!(
            !partial.exists(),
            "Partial file must not exist after rejection"
        );
        assert!(!target.exists(), "Target file must not exist");
    }
}
