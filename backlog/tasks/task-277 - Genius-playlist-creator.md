---
id: TASK-277
title: Genius playlist creator
status: Done
assignee: []
created_date: '2026-02-18 05:58'
updated_date: '2026-04-04 07:51'
labels:
  - feature
  - playlists
  - recommendation
  - agent
  - ollama
  - lastfm
dependencies:
  - TASK-308
  - TASK-277.1
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
- [x] #1 User can enter a natural language prompt to generate a playlist
- [x] #2 System uses local LLM (Ollama + qwen3.5:9b) to interpret prompts and call appropriate tools
- [x] #3 8 tools available: GetRecentlyPlayed, GetTopArtists, SearchLibrary, GetSimilarTracks, GetSimilarArtists, GetTrackTags, GetTopArtistsByTag, GetTopTracksByCountry
- [x] #4 Generated playlist only contains tracks that exist in user's local library
- [x] #5 Graceful degradation: works without Last.fm (local-only tools), works without Ollama (returns setup instructions)
- [x] #6 Feature-flagged behind `agent` — zero overhead when disabled
- [x] #7 Onboarding wizard: Ollama check → model download → ready
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

Documented next-step options only; not started in this commit:
1. Continue Python-only validation before any Rust port.
2. Prototype deterministic candidate aggregation/finalization in `scripts/agent.py` so the LLM does discovery/routing while Python enforces playlist policy.
3. Candidate guard rails to evaluate: track count bounds, one-track-per-artist default, seed-artist cap for artist-based prompts, scoring by supporting tool sources, local genre, Last.fm similarity/tag evidence, and recency/history signals.
4. Once Python business logic is stable across mood, artist-based, and mixed-history prompts, port the proven rules to Rust.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 2026-04-02: Python to Rust Migration Complete

Successfully migrated the Python reference implementation to Rust:

### Changes Made

**prompt.rs** - Updated system prompt with enhanced artist variety rules:
- Added "DEFAULT to 1 track per artist for MAXIMUM variety"
- Added "PRIORITY: 20 tracks from 20 different artists > 20 tracks from 10 artists with 2 each"
- Added "A playlist should feel like a JOURNEY through different artists, not an artist deep dive"
- Added "When compiling: pick the BEST track from each artist, then move on"
- Converted to raw string literal (`r#"..."#`) for cleaner syntax
- Added CRITICAL section warning against common mistakes (keyword searches)

**mod.rs** - Added artist-spreading shuffle algorithm and duplicate name handling:
- `shuffle_spread_artists()` function uses greedy approach to spread same-artist tracks apart
- `generate_unique_playlist_name()` automatically appends (2), (3), etc. for duplicate names
- Groups tracks by artist, shuffles each group locally, then greedily selects from the artist with most remaining tracks (excluding the last-played artist when possible)
- Updated `agent_generate_playlist()` to:
  1. Fetch track details (id + artist) for parsed track IDs
  2. Shuffle using `shuffle_spread_artists()` before adding to playlist
  3. Handle duplicate playlist names by appending numbers
  4. Log validation count and shuffling info

### Key Features Ported from Python
1. **Artist variety priority** - System prompt enforces 1 track per artist by default
2. **Shuffled output** - Greedy algorithm spreads same-artist tracks apart in final playlist
3. **Track validation** - Verifies all track IDs exist in library before shuffling
4. **Unique playlist names** - Automatically appends (2), (3), etc. if name exists
5. **Configurable limits** - Min/max tracks dynamically calculated from MAX_PLAYLIST_TRACKS

### Test Coverage
- 5 unit tests for `shuffle_spread_artists()`:
  - Empty input returns empty
  - Spreads same-artist tracks apart (no adjacent duplicates)
  - Preserves all tracks in output
  - Single track works correctly
  - Unique artists handled properly
- 2 unit tests for `generate_unique_playlist_name()`:
  - Returns base name when available
  - Appends number when name exists

Total: 764 tests pass (762 existing + 2 new)

2026-04-02: Added `PROMPT` override support to `scripts/agent.py` via python-decouple so prompt experiments can run without changing the default built-in system prompt. `_build_system_prompt()` now keeps the existing prompt for normal runs and uses the env-provided override when present, still interpolating `{min_tracks}` and `{max_tracks}`. Console output now reports whether the run used the default prompt or the override.

2026-04-02: Prompt experiment results in Python:
- Mood request (`make me a chill playlist`): default prompt used 4 turns; override prompt used 2 turns with valid library-only output.
- Artist-based request (`make me a playlist like Radiohead`): default prompt used 3 turns; override prompt used 2 turns, but prompt-only steering still leaked multiple seed-artist tracks.
- Mixed-history request (`make me a chill playlist like what I listened to last Friday`): default prompt used 4 turns; override prompt used 2 turns and treated weak recent-history results as a weighting signal instead of spending extra turns matching them exactly.

2026-04-02: Conclusion from prompt experiments: tighter stop rules materially reduce turn count, but prompt-only business-rule enforcement remains unreliable for cases like seed-artist caps. The most promising direction is to keep LLM-driven discovery/tool routing while moving playlist compilation and policy enforcement into deterministic business logic that scores and filters candidates using empirical evidence (tool source overlap, local genre, Last.fm tags/similarity, last played date, play history, and explicit duplicate-artist caps).

## 2026-04-03: Python-to-Rust migration finalized

Swapped AC#2 model from llama3.2:1b to qwen3.5:9b (matches Python agent). Ported remaining Python logic to Rust via rig:

### prompt.rs
- Added PLAYLIST NAMING section (creative synonyms, not parroting user's words)
- Added decade/era strategy (search_library with decade+genre, parallel get_top_artists_by_tag)
- Documented all search_library filters (keyword, artist, album, genre, decade, year range)
- Clarified search_library(query=...) vs search_library(genre=...) in CRITICAL section

### tools.rs — SearchLibrary expanded
- Added genre, decade, year_from, year_to args + tool definition
- Programmatic `parse_decade()` handles any century ("90s" -> 1990-1999, "1780s" -> 1780-1789)
- 6 new tests: parse_decade (4) + genre/decade filter integration (2)

### db/library.rs — LibraryQuery expanded
- Added genre (LIKE), year_from, year_to fields to LibraryQuery struct
- Added filtering logic in get_all_tracks() SQL builder

### mod.rs — build_agent() tuned
- Temperature: 0.2 -> 0.3 (matches Python)
- max_tokens: 1024 -> 2048 (prevents response truncation)
- Added repeat_penalty: 1.1 (prevents token repetition/gibberish)
- Preamble set via rig's `.preamble()` builder method

### Test coverage
770 tests pass (764 existing + 6 new). No regressions with or without agent feature.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Full Genius playlist creator implemented across 7 phases: Rig + Ollama agent framework with 8 tools (GetRecentlyPlayed, GetTopArtists, SearchLibrary, GetSimilarTracks, GetSimilarArtists, GetTrackTags, GetTopArtistsByTag, GetTopTracksByCountry), onboarding wizard, chat-style UI with animated prompts, Shift+Enter generation shortcut, artist-spreading shuffle, unique playlist naming, and comprehensive test coverage (770 Rust tests with agent feature, 386 frontend unit tests).
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 cargo check --features agent compiles
- [x] #2 cargo check (without agent) compiles — no regressions
- [x] #3 cargo nextest run --workspace passes
- [x] #4 Unit tests for each tool's call() method
- [x] #5 Agent evals pass with mock Ollama server
<!-- DOD:END -->
