---
id: TASK-277
title: Genius playlist creator
status: In Progress
assignee: []
created_date: '2026-02-18 05:58'
updated_date: '2026-03-31 20:16'
labels:
  - feature
  - playlists
  - recommendation
dependencies: []
priority: high
ordinal: 750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a conversational playlist generator using Rig (Rust agent framework) + Ollama for local LLM inference. Natural language prompts like "make me a chill playlist like what I listened to last Friday" get interpreted by a small local LLM (llama3.2:1b) that routes to Last.fm similarity APIs and local library queries, then creates a playlist from the results.

Uses Rig (`0xplaygrounds/rig`) as the agent framework with Ollama as the provider. Rig handles tool-call protocol, multi-turn loop, and Ollama communication. Feature-flagged behind `agent` so it adds zero overhead for users who don't want it.

Design document: `~/.claude/plans/steady-juggling-scroll.md`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 User can enter a natural language prompt to generate a playlist
- [ ] #2 System uses local LLM (Ollama + llama3.2:1b) to interpret prompts and call appropriate tools
- [ ] #3 8 tools available: GetRecentlyPlayed, GetTopArtists, SearchLibrary, GetSimilarTracks, GetSimilarArtists, GetTrackTags, GetTopArtistsByTag, GetTopTracksByCountry
- [ ] #4 Generated playlist only contains tracks that exist in user's local library
- [ ] #5 Graceful degradation: works without Last.fm (local-only tools), works without Ollama (returns setup instructions)
- [x] #6 Feature-flagged behind `agent` — zero overhead when disabled
- [ ] #7 Onboarding wizard: Ollama check → model download → ready
- [ ] #8 Agent evals pass (tool selection, output format, degradation)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Phase 1: Dependencies (DONE)

Added to `crates/mt-tauri/Cargo.toml`:

- `rig-core = { version = "0.27", features = ["experimental"], optional = true }`
- `schemars = { version = "1", optional = true }`
- Feature: `agent = ["dep:rig-core", "dep:schemars"]`

Verified: `cargo check --features agent` and `cargo check` (without) both compile.

## Phase 2: Types + Prompt + Module Scaffold (DONE)

Created `crates/mt-tauri/src/agent/` module with 3 files:

### `types.rs`
- `TrackSummary` — lightweight track representation with `JsonSchema` derive, `from_track()` converter
- `AgentStatus` enum — `Success`, `NoOllama`, `NoModel`, `Error` (snake_case serialization)
- `AgentResponse` — Tauri command response with convenience constructors, `skip_serializing_if` on Option fields
- `AgentContext` — holds `Database` + `LastFmClient` for tool injection
- `AgentError` — thiserror enum with `#[from]` for DbError, LastFmError, reqwest::Error
- `ParsedPlaylist` — name + track_ids parsed from LLM output
- `AgentStatusResponse` — for `agent_check_status` command
- 5 unit tests

### `prompt.rs`
- `SYSTEM_PROMPT` const — optimized for 1B models, mentions all 8 tools, defines response format
- `DEFAULT_MODEL` = `"llama3.2:1b"`
- `OLLAMA_BASE_URL` = `"http://localhost:11434"`
- `MAX_AGENT_TURNS` = `5`
- 3 unit tests

### `mod.rs`
- Module exports (`pub mod types; pub mod prompt;`)
- `parse_agent_response()` — robust LLM output parser (handles brackets, preamble, mixed valid/invalid IDs)
- Placeholder `agent_generate_playlist` and `agent_check_status` functions
- 8 unit tests for parser edge cases

### `lib.rs` wiring
- `#[cfg(feature = "agent")] pub(crate) mod agent;` module declaration
- Thin wrapper Tauri commands with `#[cfg(feature/not(feature))]` pairs
- Graceful "not enabled" JSON response when feature is off
- Commands registered unconditionally in `generate_handler!`

Verified: `cargo check --features agent`, `cargo check`, and 17/17 agent tests pass.

## Phase 3: Tools (`tools.rs`)

Implement 8 tools with Rig's `Tool` trait, each receiving `Arc<AgentContext>`:

1. **GetRecentlyPlayed** — `db::favorites::get_recently_played`
2. **GetTopArtists** — `db::stats::get_top_artists`
3. **SearchLibrary** — `db::library::get_all_tracks`
4. **GetSimilarTracks** — Last.fm `track.getSimilar` + library cross-ref
5. **GetSimilarArtists** — Last.fm `artist.getSimilar` + library cross-ref
6. **GetTrackTags** — Last.fm `track.getTopTags`
7. **GetTopArtistsByTag** — Last.fm `tag.getTopArtists` + library cross-ref
8. **GetTopTracksByCountry** — Last.fm `geo.getTopTracks` + library cross-ref

TDD: Unit test each tool's `call()` with test DB; mock Last.fm responses for similarity tools.

## Phase 4: Agent Loop + Tauri Commands

- `build_agent(ctx)` — construct Rig agent with all 8 tools + system prompt
- Wire real implementation into `agent_generate_playlist`: health check -> build agent -> run (max 5 turns) -> parse track IDs -> create playlist
- Wire real implementation into `agent_check_status`: check Ollama + model availability

## Phase 5: Onboarding + Setup (`setup.rs`)

Tauri commands:

- `agent_check_ollama()` — health check Ollama, list models
- `agent_pull_model(model)` — stream model download with progress events
- `agent_get_onboarding_state()` / `agent_set_onboarding_complete()` — persist via tauri-plugin-store

## Phase 6: Evals (`evals.rs`)

Heuristic evals (no LLM judge):

- Tool selection evals (correct tools per prompt class)
- Output format evals (parseable response, no hallucinated IDs)
- Degradation evals (graceful fallback when Last.fm tools fail)

Gated behind `--features agent`; CI uses mock HTTP server.

## Phase 7: Frontend — Genius Sidebar Category + Prompt UI

- Genius sidebar category with wayfarer glasses icon
- Natural language prompt input + Generate button
- Loading state while agent runs
- Onboarding wizard (3 steps): Ollama check -> model download -> ready
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Current State (2026-03-31)

- Phase 1 (deps) complete
- Phase 2 (types + prompt + module scaffold) complete — 3 files, 17 tests
- Phase 3 (tools) complete — 8 Tool trait implementations, 12 tests
- Phase 4 (agent loop + Tauri commands) complete — real implementations, 20 tests in mod.rs

Both `cargo check --features agent` and `cargo check` pass.
726/726 tests pass with `cargo nextest run --workspace --features agent`.

## Key Design Decisions

- Feature-flagged (`agent`) — zero overhead when disabled
- Uses llama3.2:1b via Ollama — small enough for local inference
- 8 tools covering local library + Last.fm APIs with graceful degradation
- Heuristic evals (no LLM judge) for deterministic CI
- Thin wrapper Tauri commands in lib.rs with cfg pairs (agent/not-agent) to keep generate_handler! unconditional
- Agent module functions are plain async fns (not #[tauri::command]) — lib.rs wrappers handle Tauri integration
- LastFmClient constructed fresh inside agent_generate_playlist (not managed as Tauri state)

## Rig API Notes (v0.27 + experimental)

- `rig::client::CompletionClient` trait needed for `.agent()` method on client
- `rig::completion::Prompt` trait needed for `.prompt()` method on agent
- `.multi_turn(N)` (NOT `.max_turns(N)`) controls tool-call loop depth
- `ollama::Client::builder().api_key(rig::client::Nothing).base_url(URL).build()` — builder pattern avoids env var panic
- Agent construction requires Tokio runtime (for tool registration) — test with `#[tokio::test]`

## Files Created/Modified

- `crates/mt-tauri/src/agent/mod.rs` — module root, parse_agent_response, parse_model_names, has_default_model, check_ollama, build_agent, agent_generate_playlist, agent_check_status
- `crates/mt-tauri/src/agent/types.rs` — AgentResponse, TrackSummary, AgentContext, AgentError, ParsedPlaylist, AgentStatusResponse
- `crates/mt-tauri/src/agent/prompt.rs` — SYSTEM_PROMPT, DEFAULT_MODEL, OLLAMA_BASE_URL, MAX_AGENT_TURNS
- `crates/mt-tauri/src/agent/tools.rs` — 8 Tool implementations
- `crates/mt-tauri/src/lastfm/client.rs` — 5 discovery methods (get_similar_tracks, get_similar_artists, get_track_top_tags, get_top_artists_by_tag, get_top_tracks_by_country)
- `crates/mt-tauri/src/lastfm/types.rs` — response types for discovery methods
- `crates/mt-tauri/Cargo.toml` — rig-core + schemars deps
- `crates/mt-tauri/src/lib.rs` — agent module declaration + wrapper Tauri commands

## Next: Phase 5 (Onboarding + Setup)
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 cargo check --features agent compiles
- [x] #2 cargo check (without agent) compiles — no regressions
- [x] #3 cargo nextest run --workspace passes
- [x] #4 Unit tests for each tool's call() method
- [ ] #5 Agent evals pass with mock Ollama server
<!-- DOD:END -->
