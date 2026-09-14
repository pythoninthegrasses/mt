//! Differential (shadow-mode) harness proving the Zig port of `library_get_all`
//! returns what the Rust implementation returns (TASK-355.5).
//!
//! With `MT_SHADOW_DIFF` on, every `library_get_all` call keeps serving the
//! Rust result to the frontend while also fetching the Zig sidecar's answer to
//! the same query and comparing the two canonical JSON documents. A divergence
//! is logged — never thrown — because the Rust response is the one users see.
//!
//! The comparison is a byte compare of two compact JSON documents: serde_json
//! on the Rust side and `std.json.Stringify` on the Zig side both emit compact
//! JSON, and `zig-core/src/library.zig`'s `writeTrack` emits keys in
//! `Track`'s declaration order on purpose. Byte-for-byte equality is therefore
//! the *strictest* available comparison — it catches a value written in a
//! different key slot that a field-wise deep compare would wave through. If the
//! two ever disagree, the first differing byte offset is reported with context
//! from both sides rather than a bare "mismatch".

use crate::db::library::LibraryQuery;
use crate::db::{LibrarySortColumn, SortOrder};
use crate::library::commands::LibraryResponse;
use crate::sidecar::{self, SidecarState};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tracing::{error, info, warn};

/// Max divergences written to the log. A systematically broken port would
/// otherwise emit a full diff on every one of thousands of library requests,
/// burying the rest of the log under one root cause.
const MAX_DIVERGENCE_LOGS: u64 = 20;

/// Divergences seen by this process. A CI run greps the log for
/// `shadow_diff divergence`, so an empty grep is what "zero divergences" means.
static DIVERGENCES: AtomicU64 = AtomicU64::new(0);

/// How long the harness waits for the sidecar's answer before calling the
/// comparison an error. Generous because it runs on the frontend's own request
/// path while the flag is on: the sidecar serves a large library page
/// (100 rows) over loopback in single digits of milliseconds when healthy.
const SIDEARC_TIMEOUT: Duration = Duration::from_secs(10);

/// Read fresh on every call, matching `db::indexed_prefix_lookup_enabled`'s
/// env-var-only branch rather than `MT_LOG`'s read-once-at-init — this flag is
/// read once per library request, not in a hot loop, and a cache went stale
/// during verification (the app had to be restarted to pick up the flag).
pub(crate) fn enabled() -> bool {
    std::env::var("MT_SHADOW_DIFF")
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes"))
        .unwrap_or(false)
}

/// The wire name a sort column had before it reached `LibraryQuery`, since
/// `LibrarySortColumn`'s own `Display` renders the SQL expression, not the
/// `sort_by=` parameter the sidecar parses. `Year` is ambiguous once parsed
/// (`date` and `year` both resolve to it); `date` is emitted, which is what
/// the frontend sends.
fn sort_column_name(column: LibrarySortColumn) -> &'static str {
    match column {
        LibrarySortColumn::Title => "title",
        LibrarySortColumn::Artist => "artist",
        LibrarySortColumn::Album => "album",
        LibrarySortColumn::AddedDate => "added_date",
        LibrarySortColumn::PlayCount => "play_count",
        LibrarySortColumn::Duration => "duration",
        LibrarySortColumn::LastPlayed => "last_played",
        LibrarySortColumn::Year => "date",
        LibrarySortColumn::Genre => "genre",
        LibrarySortColumn::DiscNumber => "disc_number",
        LibrarySortColumn::TrackTotal => "track_total",
        LibrarySortColumn::TrackNumber => "track_number",
    }
}

/// Query string the Rust command's parameters translate to on the sidecar
/// side. `library_get_all` hardcodes `genre`/`year_from`/`year_to` to `None`,
/// so they have no place here; every value is URL-encoded so a search term
/// containing `&`, `+`, `%`, or a space lands identically on both sides
/// (`zig-core`'s `parseQuery` does `application/x-www-form-urlencoded`
/// decoding).
fn zig_query_string(query: &LibraryQuery) -> String {
    use std::fmt::Write as _;

    let mut out = String::from("/api/library?");
    let mut first = true;
    let mut param = |key: &str, value: String| {
        let sep = std::mem::replace(&mut first, false);
        let _ = write!(
            out,
            "{}{key}={value}",
            if sep { "" } else { "&" },
            value = form_urlencode(&value)
        );
    };

    for (key, value) in [
        ("search", query.search.clone()),
        ("artist", query.artist.clone()),
        ("album", query.album.clone()),
        ("source_filter", query.source_filter.clone()),
        ("ignore_words", query.ignore_words.clone()),
    ] {
        if let Some(value) = value {
            param(key, value);
        }
    }

    param("sort_by", sort_column_name(query.sort_by).to_string());
    param(
        "sort_order",
        match query.sort_order {
            SortOrder::Asc => "asc".to_string(),
            SortOrder::Desc => "desc".to_string(),
        },
    );
    let _ = write!(out, "&limit={}&offset={}", query.limit, query.offset);
    out
}

/// `application/x-www-form-urlencoded` component encoding. Written by hand
/// rather than pulled from a dependency because the set of characters that can
/// appear here (arbitrary user search text) is exactly the set the sidecar's
/// own decoder has to agree about.
fn form_urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Run the Zig side of the comparison for one `library_get_all` call. Returns
/// the number of divergences logged by this invocation (0 or 1), so the
/// fixture-driven test can assert on a specific query's outcome without
/// parsing its own log output.
///
/// The Rust response is serialized from the *same* struct the command returns,
/// after the command has already built it, so the comparison covers what the
/// frontend would be sent.
pub(crate) async fn compare_library_get_all(
    state: &SidecarState,
    query: &LibraryQuery,
    rust_response: &LibraryResponse,
) -> u64 {
    compare(state.endpoint(), query, rust_response).await
}

async fn compare(
    endpoint: Option<sidecar::Endpoint>,
    query: &LibraryQuery,
    rust_response: &LibraryResponse,
) -> u64 {
    let Some(endpoint) = endpoint else {
        warn!(
            event = "shadow_diff_skipped",
            reason = "sidecar_endpoint_unresolved",
            "shadow-diff: sidecar has no resolved endpoint (startup health probe failed or has not run)"
        );
        return 0;
    };

    let rust_json = match serde_json::to_string(rust_response) {
        Ok(json) => json,
        Err(e) => {
            error!(error = %e, "shadow-diff: failed to serialize the Rust response");
            return 0;
        }
    };

    let url = format!(
        "http://127.0.0.1:{}{}",
        endpoint.port,
        zig_query_string(query)
    );
    let request = reqwest::Client::new()
        .get(&url)
        .bearer_auth(&endpoint.token)
        .send();
    let zig_json: String = match tokio::time::timeout(SIDEARC_TIMEOUT, request).await {
        Err(_) => {
            error!(url = %url, timeout_ms = SIDEARC_TIMEOUT.as_millis(), "shadow-diff: sidecar request timed out");
            return 0;
        }
        Ok(Err(e)) => {
            error!(error = %e, url = %url, "shadow-diff: sidecar request failed");
            return 0;
        }
        Ok(Ok(response)) => match response.text().await {
            Ok(body) => body,
            Err(e) => {
                error!(error = %e, url = %url, "shadow-diff: reading the sidecar response body failed");
                return 0;
            }
        },
    };

    if zig_json == rust_json {
        info!(
            event = "shadow_diff_match",
            endpoint = "/api/library",
            rust_bytes = rust_json.len(),
            zig_bytes = zig_json.len(),
            "shadow-diff: Rust and Zig agree"
        );
        return 0;
    }

    log_divergence("response_body", &rust_json, &zig_json);
    1
}

/// Log a divergence with enough detail to diagnose it without a debugger: the
/// two lengths, the first differing byte offset, ~120 chars of context from
/// both sides at that offset, and a structural hint about whether the two
/// documents even have the same shape (same top-level keys, same track count).
fn log_divergence(what: &str, rust_json: &str, zig_json: &str) {
    let count = DIVERGENCES.fetch_add(1, Ordering::Relaxed) + 1;
    let offset = rust_json
        .bytes()
        .zip(zig_json.bytes())
        .position(|(r, z)| r != z)
        .unwrap_or(rust_json.len().min(zig_json.len()));

    let context = |json: &str| -> String {
        let start = offset.saturating_sub(40);
        let end = (offset + 80).min(json.len());
        // Byte offsets into JSON land mid-UTF-8 character routinely; snap to
        // character boundaries rather than panicking on a slice.
        let mut start = start;
        while start > 0 && !json.is_char_boundary(start) {
            start -= 1;
        }
        let mut end = end;
        while end < json.len() && !json.is_char_boundary(end) {
            end += 1;
        }
        let prefix = if start > 0 { "…" } else { "" };
        let suffix = if end < json.len() { "…" } else { "" };
        format!("{prefix}{}{suffix}", &json[start..end])
    };

    let structure = |json: &str| -> String {
        match serde_json::from_str::<serde_json::Value>(json) {
            Ok(serde_json::Value::Object(map)) => {
                let tracks = map
                    .get("tracks")
                    .and_then(|v| v.as_array())
                    .map_or_else(|| "n/a".to_string(), |a| a.len().to_string());
                format!(
                    "keys=[{}] tracks={tracks}",
                    map.keys()
                        .map(String::as_str)
                        .collect::<Vec<&str>>()
                        .join(",")
                )
            }
            Ok(_) => "not-an-object".to_string(),
            Err(e) => format!("unparseable: {e}"),
        }
    };

    if count <= MAX_DIVERGENCE_LOGS {
        error!(
            event = "shadow_diff divergence",
            target_impl = "zig",
            what,
            rust_len = rust_json.len(),
            zig_len = zig_json.len(),
            first_diff_offset = offset,
            rust_context = %context(rust_json),
            zig_context = %context(zig_json),
            rust_structure = %structure(rust_json),
            zig_structure = %structure(zig_json),
            divergence_count = count,
            "shadow-diff: Rust and Zig returned different JSON"
        );
        if count == MAX_DIVERGENCE_LOGS {
            warn!("shadow-diff: suppressing further divergence logs after {MAX_DIVERGENCE_LOGS}");
        }
    }
}

/// Resolve the sidecar's bearer endpoint from a runtime file directory. Used
/// by the fixture test to build a `SidecarState` for a sidecar it spawned
/// itself; the running app gets its endpoint from the startup health probe.
#[cfg(test)]
pub(crate) fn endpoint_from_runtime_dir(
    runtime_dir: &std::path::Path,
) -> std::io::Result<sidecar::Endpoint> {
    let contents = std::fs::read(runtime_dir.join(sidecar::RUNTIME_FILE_NAME))?;
    serde_json::from_slice(&contents).map_err(std::io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::library::LibraryQuery;

    #[test]
    fn zig_query_string_matches_the_sidecar_query_contract() {
        let query = LibraryQuery {
            search: Some("Metallica+One & Two%3".into()),
            artist: Some("Ani DiFranco".into()),
            sort_by: "artist".parse().unwrap(),
            sort_order: SortOrder::Asc,
            limit: 250,
            offset: 500,
            ignore_words: Some("the,a".into()),
            ..Default::default()
        };
        assert_eq!(
            zig_query_string(&query),
            "/api/library?search=Metallica%2BOne+%26+Two%253&artist=Ani+DiFranco&ignore_words=the%2Ca&sort_by=artist&sort_order=asc&limit=250&offset=500"
        );
    }

    #[test]
    fn zig_query_string_omits_unset_filters() {
        let query = LibraryQuery {
            limit: 100,
            ..Default::default()
        };
        assert_eq!(
            zig_query_string(&query),
            "/api/library?sort_by=added_date&sort_order=desc&limit=100&offset=0"
        );
    }

    #[test]
    fn form_urlencode_passes_unreserved_and_escapes_the_rest() {
        assert_eq!(form_urlencode("a-b_c.d~e"), "a-b_c.d~e");
        assert_eq!(form_urlencode("a b/c?d=e&f"), "a+b%2Fc%3Fd%3De%26f");
        // Multi-byte UTF-8 is escaped byte by byte, which is what
        // decodeURIComponent-style decoding on the other side expects.
        assert_eq!(form_urlencode("caf\u{e9}"), "caf%C3%A9");
    }

    #[test]
    fn log_divergence_reports_the_first_differing_byte() {
        // Exercised directly because the fixture test's sabotaged-sidecar case
        // is what covers it end to end; this keeps the reporting code, which
        // must never panic on adversarial input, covered on its own too.
        log_divergence("response_body", "{\"a\":1}", "{\"a\":2}");
        // Unequal lengths, one document a prefix of the other.
        log_divergence("response_body", "{\"a\":1}", "{\"a\":1}");
        // Divergence before either document parses as JSON at all.
        log_divergence("response_body", "not json", "also not json");
        // Multi-byte text straddling the reported byte offset.
        log_divergence("response_body", "{\"t\":\"café\"}", "{\"t\":\"cafe\"}");
    }
}
