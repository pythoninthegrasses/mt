//! Heuristic agent evaluations with a mock Ollama server.
//!
//! These tests verify the agent pipeline end-to-end without requiring a real
//! LLM. A wiremock `MockServer` simulates Ollama's `/api/chat` and `/api/tags`
//! endpoints, returning canned tool-call and text responses so we can assert:
//!
//! - **Tool execution**: the agent correctly invokes tools and pipes results
//!   through the conversation loop.
//! - **Output format**: `parse_agent_response` handles well-formed, malformed,
//!   and edge-case responses.
//! - **Degradation**: the system gracefully handles an unreachable Ollama.

use std::sync::Arc;

use rig::completion::Prompt;
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::types::{AgentContext, AgentError};
use super::{build_agent, check_ollama, parse_agent_response};
use crate::db::Database;
use crate::lastfm::client::LastFmClient;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a test `AgentContext` with an in-memory database and unconfigured
/// Last.fm client.
fn test_context() -> Arc<AgentContext> {
    let db = Database::new_in_memory().expect("in-memory db");
    let lastfm = LastFmClient::new_unconfigured();
    Arc::new(AgentContext { db, lastfm })
}

/// Insert a track and return its row id.
fn insert_track(ctx: &AgentContext, title: &str, artist: &str, album: &str, genre: &str) -> i64 {
    ctx.db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO library (filepath, title, artist, album, genre, missing)
                 VALUES (?, ?, ?, ?, ?, 0)",
                rusqlite::params![
                    format!("/music/{artist}/{album}/{title}.flac"),
                    title,
                    artist,
                    album,
                    genre,
                ],
            )?;
            Ok(conn.last_insert_rowid())
        })
        .expect("insert track")
}

/// Mark a track as recently played so `get_recently_played` returns it.
fn mark_played(ctx: &AgentContext, track_id: i64) {
    ctx.db
        .with_conn(|conn| {
            conn.execute(
                "UPDATE library SET last_played = datetime('now'), play_count = COALESCE(play_count, 0) + 1 WHERE id = ?",
                rusqlite::params![track_id],
            )?;
            conn.execute(
                "INSERT INTO play_history (track_id, played_at) VALUES (?, datetime('now'))",
                rusqlite::params![track_id],
            )?;
            Ok(())
        })
        .expect("mark played");
}

/// JSON body for a `/api/tags` response listing the default model.
fn tags_response() -> serde_json::Value {
    serde_json::json!({
        "models": [{ "name": "qwen3.5:9b", "size": 1_000_000 }]
    })
}

/// JSON body for an Ollama chat response that requests a tool call.
fn tool_call_response(tool_name: &str, arguments: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "model": "qwen3.5:9b",
        "created_at": "2025-01-01T00:00:00Z",
        "message": {
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "type": "function",
                "function": {
                    "name": tool_name,
                    "arguments": arguments
                }
            }]
        },
        "done": true,
        "done_reason": "stop"
    })
}

/// JSON body for an Ollama chat response that contains the final playlist text.
fn final_response(text: &str) -> serde_json::Value {
    serde_json::json!({
        "model": "qwen3.5:9b",
        "created_at": "2025-01-01T00:00:00Z",
        "message": {
            "role": "assistant",
            "content": text,
            "tool_calls": []
        },
        "done": true,
        "done_reason": "stop"
    })
}

/// Mount the `/api/tags` mock that returns the default model.
async fn mount_tags(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path("/api/tags"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tags_response()))
        .mount(server)
        .await;
}

/// Mount a two-turn chat flow: first response triggers a tool call, second
/// (after the tool result is appended) returns the final playlist text.
///
/// Discrimination strategy: the second request contains `"role":"tool"` in
/// its body (the tool result message). The more-specific matcher wins in
/// wiremock when both could match.
async fn mount_tool_then_final(
    server: &MockServer,
    tool_name: &str,
    tool_args: serde_json::Value,
    final_text: &str,
) {
    // Second call — matches when the body contains a tool-result message.
    Mock::given(method("POST"))
        .and(path("/api/chat"))
        .and(body_string_contains("\"role\":\"tool\""))
        .respond_with(ResponseTemplate::new(200).set_body_json(final_response(final_text)))
        .expect(1)
        .mount(server)
        .await;

    // First call — general matcher (no tool result yet).
    Mock::given(method("POST"))
        .and(path("/api/chat"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(tool_call_response(tool_name, tool_args)),
        )
        .expect(1)
        .mount(server)
        .await;
}

// ---------------------------------------------------------------------------
// Tool execution evals
// ---------------------------------------------------------------------------

/// Eval: agent invokes `get_recently_played`, receives results from the
/// in-memory database, and produces a parseable playlist response.
#[tokio::test]
async fn eval_tool_execution_get_recently_played() {
    let server = MockServer::start().await;
    let ctx = test_context();

    // Seed database with recently played tracks
    let id1 = insert_track(&ctx, "Everlong", "Foo Fighters", "TCATS", "Rock");
    let id2 = insert_track(&ctx, "Creep", "Radiohead", "Pablo Honey", "Alt Rock");
    let id3 = insert_track(&ctx, "Karma Police", "Radiohead", "OK Computer", "Alt Rock");
    mark_played(&ctx, id1);
    mark_played(&ctx, id2);
    mark_played(&ctx, id3);

    mount_tags(&server).await;
    mount_tool_then_final(
        &server,
        "get_recently_played",
        serde_json::json!({"days": 7, "limit": 20}),
        &format!("Playlist: Recent Vibes\nTracks: {id1}, {id2}, {id3}"),
    )
    .await;

    let agent = build_agent(Arc::clone(&ctx), &server.uri());
    let response = agent
        .prompt("Make a playlist from my recent listening")
        .multi_turn(5)
        .await
        .expect("agent prompt should succeed");

    let parsed = parse_agent_response(&response).expect("should parse");
    assert_eq!(parsed.name, "Recent Vibes");
    assert_eq!(parsed.track_ids, vec![id1, id2, id3]);
}

/// Eval: agent invokes `search_library` and the tool returns matching tracks
/// from the in-memory database.
#[tokio::test]
async fn eval_tool_execution_search_library() {
    let server = MockServer::start().await;
    let ctx = test_context();

    let id1 = insert_track(&ctx, "Black Dog", "Led Zeppelin", "Led Zeppelin IV", "Rock");
    let id2 = insert_track(
        &ctx,
        "Stairway to Heaven",
        "Led Zeppelin",
        "Led Zeppelin IV",
        "Rock",
    );
    // Unrelated track that should not appear
    insert_track(&ctx, "Creep", "Radiohead", "Pablo Honey", "Alt Rock");

    mount_tags(&server).await;
    mount_tool_then_final(
        &server,
        "search_library",
        serde_json::json!({"artist": "Led Zeppelin"}),
        &format!("Playlist: Zeppelin Classics\nTracks: {id1}, {id2}"),
    )
    .await;

    let agent = build_agent(Arc::clone(&ctx), &server.uri());
    let response = agent
        .prompt("I want a Led Zeppelin playlist")
        .multi_turn(5)
        .await
        .expect("agent prompt should succeed");

    let parsed = parse_agent_response(&response).expect("should parse");
    assert_eq!(parsed.name, "Zeppelin Classics");
    assert_eq!(parsed.track_ids, vec![id1, id2]);
}

/// Eval: agent invokes `get_top_artists` and the tool returns play-count
/// ranked artists from the in-memory database.
#[tokio::test]
async fn eval_tool_execution_get_top_artists() {
    let server = MockServer::start().await;
    let ctx = test_context();

    // Radiohead: 3 plays
    for title in ["Creep", "Karma Police", "Paranoid Android"] {
        let id = insert_track(&ctx, title, "Radiohead", "OK Computer", "Rock");
        mark_played(&ctx, id);
    }
    // Bjork: 1 play
    let bjork_id = insert_track(&ctx, "Army of Me", "Bjork", "Post", "Electronic");
    mark_played(&ctx, bjork_id);

    mount_tags(&server).await;
    mount_tool_then_final(
        &server,
        "get_top_artists",
        serde_json::json!({"range": "all_time", "limit": 5}),
        &format!("Playlist: Top Artist Mix\nTracks: 1, 2, 3, {bjork_id}"),
    )
    .await;

    let agent = build_agent(Arc::clone(&ctx), &server.uri());
    let response = agent
        .prompt("Make a playlist from my top artists")
        .multi_turn(5)
        .await
        .expect("agent prompt should succeed");

    let parsed = parse_agent_response(&response).expect("should parse");
    assert_eq!(parsed.name, "Top Artist Mix");
    assert!(!parsed.track_ids.is_empty());
}

// ---------------------------------------------------------------------------
// Output format evals
// ---------------------------------------------------------------------------

/// Eval: a well-formed final response parses correctly.
#[tokio::test]
async fn eval_output_format_valid_response() {
    let server = MockServer::start().await;
    let ctx = test_context();

    insert_track(&ctx, "Song", "Artist", "Album", "Genre");

    mount_tags(&server).await;

    // Return final text directly (no tool calls)
    Mock::given(method("POST"))
        .and(path("/api/chat"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(final_response("Playlist: Direct Answer\nTracks: 1")),
        )
        .mount(&server)
        .await;

    let agent = build_agent(Arc::clone(&ctx), &server.uri());
    let response = agent
        .prompt("Quick playlist")
        .multi_turn(5)
        .await
        .expect("agent prompt should succeed");

    let parsed = parse_agent_response(&response).expect("should parse");
    assert_eq!(parsed.name, "Direct Answer");
    assert_eq!(parsed.track_ids, vec![1]);
}

/// Eval: response with extra preamble/postamble text still parses.
#[test]
fn eval_output_format_with_preamble() {
    let text =
        "Here is your playlist!\n\nPlaylist: Late Night Jazz\nTracks: 5, 8, 13\n\nEnjoy listening!";
    let parsed = parse_agent_response(text).expect("should parse");
    assert_eq!(parsed.name, "Late Night Jazz");
    assert_eq!(parsed.track_ids, vec![5, 8, 13]);
}

/// Eval: response with bracketed track IDs parses correctly.
#[test]
fn eval_output_format_bracketed_ids() {
    let text = "Playlist: Bracket Test\nTracks: [10, 20, 30]";
    let parsed = parse_agent_response(text).expect("should parse");
    assert_eq!(parsed.track_ids, vec![10, 20, 30]);
}

/// Eval: malformed response (missing Playlist: line) returns an error.
#[test]
fn eval_output_format_missing_playlist_line() {
    let text = "Here are some tracks for you:\nTracks: 1, 2, 3";
    let err = parse_agent_response(text).expect_err("should fail");
    assert!(err.to_string().contains("missing 'Playlist:'"));
}

/// Eval: response with no valid track IDs returns an error.
#[test]
fn eval_output_format_no_valid_ids() {
    let text = "Playlist: Bad IDs\nTracks: abc, def, ghi";
    let err = parse_agent_response(text).expect_err("should fail");
    assert!(err.to_string().contains("no valid track IDs"));
}

/// Eval: response with hallucinated (non-integer) IDs mixed with valid ones
/// extracts only the valid IDs.
#[test]
fn eval_output_format_hallucinated_ids_filtered() {
    let text = "Playlist: Partial\nTracks: 1, imaginary_42, 3, NaN, 5";
    let parsed = parse_agent_response(text).expect("should parse");
    assert_eq!(parsed.track_ids, vec![1, 3, 5]);
}

// ---------------------------------------------------------------------------
// Degradation evals
// ---------------------------------------------------------------------------

/// Eval: `check_ollama` returns `OllamaUnavailable` when the server is not
/// reachable.
#[tokio::test]
async fn eval_degradation_ollama_unreachable() {
    // Use a URL that will definitely refuse connections
    let err = check_ollama("http://127.0.0.1:1")
        .await
        .expect_err("should fail");
    assert!(
        matches!(err, AgentError::OllamaUnavailable(_)),
        "expected OllamaUnavailable, got: {err:?}"
    );
}

/// Eval: `check_ollama` returns an empty model list when the server responds
/// with an empty models array.
#[tokio::test]
async fn eval_degradation_no_models_available() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/tags"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"models": []})))
        .mount(&server)
        .await;

    let models = check_ollama(&server.uri()).await.expect("should succeed");
    assert!(models.is_empty());
}

/// Eval: `check_ollama` succeeds and returns model names when Ollama is healthy.
#[tokio::test]
async fn eval_degradation_ollama_healthy() {
    let server = MockServer::start().await;
    mount_tags(&server).await;

    let models = check_ollama(&server.uri()).await.expect("should succeed");
    assert_eq!(models, vec!["qwen3.5:9b"]);
}

/// Eval: agent gracefully handles an empty tool result (search returns no tracks).
#[tokio::test]
async fn eval_degradation_empty_tool_result() {
    let server = MockServer::start().await;
    let ctx = test_context();
    // Intentionally empty database — search_library will return []

    mount_tags(&server).await;
    mount_tool_then_final(
        &server,
        "search_library",
        serde_json::json!({"query": "nonexistent music"}),
        "Playlist: Empty Search\nTracks: 42",
    )
    .await;

    let agent = build_agent(Arc::clone(&ctx), &server.uri());
    let response = agent
        .prompt("Find me some nonexistent music")
        .multi_turn(5)
        .await
        .expect("agent prompt should succeed even with empty tool results");

    // The mock returns track ID 42 which doesn't exist in the DB, but
    // parse_agent_response only validates format, not DB existence
    let parsed = parse_agent_response(&response).expect("should parse");
    assert_eq!(parsed.name, "Empty Search");
    assert_eq!(parsed.track_ids, vec![42]);
}

/// Eval: `check_ollama` returns an error when the server returns invalid JSON.
#[tokio::test]
async fn eval_degradation_invalid_tags_response() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/tags"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
        .mount(&server)
        .await;

    let err = check_ollama(&server.uri())
        .await
        .expect_err("should fail on invalid JSON");
    assert!(
        matches!(err, AgentError::OllamaUnavailable(_)),
        "expected OllamaUnavailable, got: {err:?}"
    );
}
