---
id: TASK-277
title: Genius playlist creator
status: In Progress
assignee: []
created_date: '2026-02-18 05:58'
updated_date: '2026-03-31 21:27'
labels:
  - feature
  - playlists
  - recommendation
  - agent
  - ollama
  - lastfm
dependencies: []
references:
  - docs/genius.md
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
- [x] #8 Agent evals pass (tool selection, output format, degradation)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Phase 1: Dependencies (DONE — commit fc5846b)

Added to `crates/mt-tauri/Cargo.toml`:

- `rig-core = { version = "0.27", features = ["experimental"], optional = true }`
- `schemars = { version = "1", optional = true }`
- Feature: `agent = ["dep:rig-core", "dep:schemars"]`

Verified: `cargo check --features agent` and `cargo check` (without) both compile.

## Phase 2: Types + Prompt + Module Scaffold (DONE — commit 2f121f7)

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
- `parse_model_names()` — extracts model names from Ollama /api/tags JSON
- `has_default_model()` — checks if default model is in available list (base name match)
- 8 unit tests for parser edge cases

### `lib.rs` wiring
- `#[cfg(feature = "agent")] pub(crate) mod agent;` module declaration
- Thin wrapper Tauri commands with `#[cfg(feature/not(feature))]` pairs
- Graceful "not enabled" JSON response when feature is off
- Commands registered unconditionally in `generate_handler!`

## Phase 3: Tools (DONE — commit d9a37c9)

Implemented 8 tools with Rig's `Tool` trait in `tools.rs`, each receiving `Arc<AgentContext>`:

1. **GetRecentlyPlayed** — `db::favorites::get_recently_played` with configurable limit/date range
2. **GetTopArtists** — `db::stats::get_top_artists` with configurable limit
3. **SearchLibrary** — `db::library::get_all_tracks` with keyword/artist/genre filters + limit
4. **GetSimilarTracks** — Last.fm `track.getSimilar` + library cross-ref via `find_track_by_artist_title`
5. **GetSimilarArtists** — Last.fm `artist.getSimilar` + library cross-ref
6. **GetTrackTags** — Last.fm `track.getTopTags`
7. **GetTopArtistsByTag** — Last.fm `tag.getTopArtists` + library cross-ref
8. **GetTopTracksByCountry** — Last.fm `geo.getTopTracks` + library cross-ref

Also added 5 Last.fm discovery methods to `lastfm/client.rs` and response types to `lastfm/types.rs`.
12 tool tests + all tools have `name()`, `description()`, `definition()` verified.

## Phase 4: Agent Loop + Tauri Commands (DONE — commit d9a37c9)

Implemented in `mod.rs`:
- `check_ollama()` — GET to `{OLLAMA_BASE_URL}/api/tags`, returns raw JSON string
- `build_agent(ctx)` — constructs Rig agent with Ollama client, all 8 tools, system prompt, multi_turn(5)
- `agent_generate_playlist(db, prompt)` — full flow: health check -> build agent -> run prompt -> parse response -> create playlist via `db::playlists::create_playlist` + `add_tracks_to_playlist` -> return AgentResponse
- `agent_check_status(db)` — checks Ollama availability + model presence -> returns AgentStatusResponse

Key patterns: `LastFmClient::new()` constructed fresh (not Tauri state), `Arc<AgentContext>` shared across tools, graceful NoOllama/NoModel status returns.

## Phase 5: Onboarding + Setup (DONE — commit f1cf52c)

Created `setup.rs` with 4 public functions:
- `check_ollama_status()` — wraps `check_ollama()` + `parse_model_names()`, returns `OllamaStatus { available, models }`
- `pull_model(app, model)` — POST streaming to `{OLLAMA_BASE_URL}/api/pull`, emits `agent://pull-progress` Tauri events with `PullProgress { status, completed, total }`, returns `PullModelResult { success, error }`
- `get_onboarding_state(app)` — reads `OnboardingState` from `agent.json` store (key: `agent_onboarding`), defaults to `{ complete: false, model: None }`
- `set_onboarding_complete(app, model)` — writes `OnboardingState { complete: true, model: Some(model) }` to store

New types in `types.rs`: `OllamaStatus`, `PullProgress`, `OnboardingState`, `PullModelResult`
4 new Tauri command pairs (cfg/not-cfg) in `lib.rs`: `agent_check_ollama`, `agent_pull_model`, `agent_get_onboarding_state`, `agent_set_onboarding_complete`
7 unit tests in setup.rs + 6 type tests in types.rs (13 total for Phase 5).

## Phase 6: Evals (DONE — commit 27f9c2e, cfg-gate fix fd8593a)

13 heuristic eval tests in `evals.rs` using wiremock mock Ollama server:

- **Tool execution evals (3)**: `eval_tool_execution_search_library`, `eval_tool_execution_get_recently_played`, `eval_tool_execution_get_top_artists` — verify mock Ollama tool-call requests trigger correct tool execution and return valid data
- **Output format evals (6)**: `eval_output_format_valid_response`, `eval_output_format_with_preamble`, `eval_output_format_bracketed_ids`, `eval_output_format_no_valid_ids`, `eval_output_format_missing_playlist_line`, `eval_output_format_hallucinated_ids_filtered` — verify `parse_agent_response()` handles all LLM output variations
- **Degradation evals (5)**: `eval_degradation_ollama_unreachable`, `eval_degradation_ollama_healthy`, `eval_degradation_empty_tool_result`, `eval_degradation_invalid_tags_response`, `eval_degradation_no_models_available` — verify graceful fallback behavior

Refactored `build_agent()` and `check_ollama()` to accept `base_url: &str` parameter for test injection.
Added `wiremock = "0.6"` to dev-dependencies.
753/753 tests pass.

Cfg-gate fix (fd8593a): After merging main (which had reverted the lastfm discovery methods), restored the methods and gated all discovery types, methods, and tests behind `#[cfg(feature = "agent")]` so default builds have zero dead_code warnings.

## Phase 7: Frontend — Genius Sidebar Category + Prompt UI — NOT STARTED

- Genius sidebar category with wayfarer glasses icon (in sidebar nav alongside Library, Playlists, etc.)
- Natural language prompt input + Generate button
- Loading state while agent runs (listen for `agent://pull-progress` events during model download)
- Onboarding wizard (3 steps): Ollama check -> model download -> ready
- Wire to Tauri commands: `agent_check_ollama`, `agent_pull_model`, `agent_get_onboarding_state`, `agent_set_onboarding_complete`, `agent_generate_playlist`, `agent_check_status`
- Alpine.js store for agent state, basecoat/Tailwind for UI components

Must satisfy AC #1 (prompt input), AC #2 (LLM interpretation), AC #3 (8 tools visible), AC #4 (local tracks only), AC #5 (graceful degradation UX).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Current State (2026-03-31)

- Phase 1 (deps) complete — commit fc5846b
- Phase 2 (types + prompt + module scaffold) complete — commit 2f121f7
- Phase 3 (tools) complete — commit d9a37c9
- Phase 4 (agent loop + Tauri commands) complete — commit d9a37c9
- Phase 5 (onboarding + setup) complete — commit f1cf52c
- Phase 6 (evals) complete — commit 27f9c2e, cfg-gate fix fd8593a
- Merged into main and pushed (fast-forward merge fd8593a)

753/753 tests pass with `cargo nextest run --workspace --features agent`.
Both `cargo check --features agent` and `cargo check` compile cleanly (zero warnings).

## Phase 5 Summary

Added `setup.rs` with 4 public functions + 13 new tests:
- `check_ollama_status()` — health check returning OllamaStatus (available/unavailable + model list)
- `pull_model(app, model)` — POST streaming to Ollama, emits `agent://pull-progress` Tauri events
- `get_onboarding_state(app)` — reads from `agent.json` store
- `set_onboarding_complete(app, model)` — writes to `agent.json` store

New types in `types.rs`: OllamaStatus, PullProgress, OnboardingState, PullModelResult

4 new Tauri command pairs (cfg/not-cfg) wired in lib.rs:
- `agent_check_ollama`, `agent_pull_model`, `agent_get_onboarding_state`, `agent_set_onboarding_complete`

## Phase 6 Summary

13 eval tests in `evals.rs` using wiremock mock Ollama server.
Categories: tool execution (3), output format (6), degradation (5).
Refactored `build_agent()` and `check_ollama()` to accept `base_url: &str` for test injection.
Added `wiremock = "0.6"` to dev-dependencies.

Cfg-gate fix: After merging main (which had reverted lastfm discovery methods), restored them and gated all discovery types, methods, and tests behind `#[cfg(feature = "agent")]`.

## Key Design Decisions

- Feature-flagged (`agent`) — zero overhead when disabled
- Uses llama3.2:1b via Ollama — small enough for local inference
- 8 tools covering local library + Last.fm APIs with graceful degradation
- Heuristic evals (no LLM judge) for deterministic CI
- Thin wrapper Tauri commands in lib.rs with cfg pairs (agent/not-agent) to keep generate_handler! unconditional
- Agent module functions are plain async fns (not #[tauri::command]) — lib.rs wrappers handle Tauri integration
- LastFmClient constructed fresh inside agent_generate_playlist (not managed as Tauri state)
- Onboarding state persisted via tauri-plugin-store (`agent.json` with key `agent_onboarding`)
- Model pull uses streaming POST to Ollama with Tauri event emission for progress

## Rig API Notes (v0.27 + experimental)

- `rig::client::CompletionClient` trait needed for `.agent()` method on client
- `rig::completion::Prompt` trait needed for `.prompt()` method on agent
- `.multi_turn(N)` (NOT `.max_turns(N)`) controls tool-call loop depth
- `ollama::Client::builder().api_key(rig::client::Nothing).base_url(URL).build()` — builder pattern avoids env var panic
- Agent construction requires Tokio runtime (for tool registration) — test with `#[tokio::test]`

## Files Created/Modified

- `crates/mt-tauri/src/agent/mod.rs` — module root, parse_agent_response, parse_model_names, has_default_model, check_ollama, build_agent, agent_generate_playlist, agent_check_status
- `crates/mt-tauri/src/agent/types.rs` — AgentResponse, TrackSummary, AgentContext, AgentError, ParsedPlaylist, AgentStatusResponse, OllamaStatus, PullProgress, OnboardingState, PullModelResult
- `crates/mt-tauri/src/agent/prompt.rs` — SYSTEM_PROMPT, DEFAULT_MODEL, OLLAMA_BASE_URL, MAX_AGENT_TURNS
- `crates/mt-tauri/src/agent/tools.rs` — 8 Tool implementations
- `crates/mt-tauri/src/agent/setup.rs` — check_ollama_status, pull_model, get/set_onboarding_state, parse_pull_progress_line
- `crates/mt-tauri/src/agent/evals.rs` — 13 eval tests with wiremock
- `crates/mt-tauri/src/lastfm/client.rs` — 5 discovery methods (cfg-gated behind agent feature)
- `crates/mt-tauri/src/lastfm/types.rs` — response types for discovery methods (cfg-gated behind agent feature)
- `crates/mt-tauri/Cargo.toml` — rig-core + schemars deps, wiremock dev-dependency
- `crates/mt-tauri/src/lib.rs` — agent module declaration + 6 wrapper Tauri commands (cfg pairs)

## Remaining

- Phase 7: Frontend — Genius sidebar category, prompt UI, onboarding wizard UI
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 cargo check --features agent compiles
- [x] #2 cargo check (without agent) compiles — no regressions
- [x] #3 cargo nextest run --workspace passes
- [x] #4 Unit tests for each tool's call() method
- [x] #5 Agent evals pass with mock Ollama server
<!-- DOD:END -->
