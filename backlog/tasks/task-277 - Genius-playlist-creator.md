---
id: TASK-277
title: Genius playlist creator
status: In Progress
assignee: []
created_date: '2026-02-18 05:58'
updated_date: '2026-03-31 19:14'
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
- [ ] #6 Feature-flagged behind `agent` — zero overhead when disabled
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

## Phase 2: Types + Prompt (`types.rs`, `prompt.rs`)

Create `crates/mt-tauri/src/agent/` module:

- `types.rs` — TrackSummary, AgentResponse, AgentStatus, AgentContext, AgentError
- `prompt.rs` — System prompt constant optimized for 1B parameter models

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

## Phase 4: Agent Loop + Tauri Commands (`mod.rs`)

- `build_agent(ctx)` — construct Rig agent with all 8 tools + system prompt
- `agent_generate_playlist(prompt)` — Tauri command: health check → build agent → run (max 5 turns) → parse track IDs → create playlist
- `agent_check_status()` — Tauri command: check Ollama + model availability

Wire into `lib.rs` under `#[cfg(feature = "agent")]`.

## Phase 5: Onboarding + Setup (`setup.rs`)

Tauri commands:

- `agent_check_ollama()` — health check Ollama, list models
- `agent_pull_model(model)` — stream model download with progress events
- `agent_get_onboarding_state()` / `agent_set_onboarding_complete()` — persist via tauri-plugin-store

## Phase 6: Evals (`evals.rs`)

Rig `Eval` trait with heuristic evals (no LLM judge):

- Tool selection evals (correct tools per prompt class)
- Output format evals (parseable response, no hallucinated IDs)
- Degradation evals (graceful fallback when Last.fm tools fail)
- Batch suite across all prompt variants

Gated behind `--features agent` + requires Ollama for full suite; CI uses mock HTTP server.

## Phase 7: Frontend — Genius Sidebar Category + Prompt UI

### Sidebar: "Genius" category

Add a new "Genius" category in the left sidebar, positioned above the existing "Playlists" section:

- **Icon**: Wayfarer glasses (thick-rimmed) SVG, inline with the category label
- **Label**: "Genius" displayed to the right of the icon
- **Behavior**: Clicking expands to show generated Genius playlists (same pattern as the Playlists section)
- Genius playlists are visually distinct from regular playlists (e.g., subtle accent or badge)
- Category only visible when `agent` feature is enabled

### Prompt input

- Text input within the Genius section: natural language prompt field
- "Generate" button triggers `invoke("agent_generate_playlist", { prompt })`
- Loading state while agent runs (spinner or progress indicator)
- If `agent_check_status` returns `no_ollama`, show onboarding wizard instead of prompt input

### Onboarding wizard (3 steps)

1. Ollama check — link to ollama.com/download + "Check Again" button
2. Model download — progress bar driven by `agent://pull-progress` events
3. Ready — confirmation + "Try it" button opens the prompt input
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Current State (2026-03-31)

- Phase 1 (deps) complete — rig-core 0.27 + schemars 1 added, feature-flagged
- Merge conflict with origin/main (version bump 1.2.3→1.2.4) resolved via stash/pop
- Both `cargo check --features agent` and `cargo check` pass
- Local changes are unstaged (Cargo.toml, Cargo.lock, schemas, cargo.yml taskfile)

## Key Design Decisions

- Feature-flagged (`agent`) — zero overhead when disabled
- Uses llama3.2:1b via Ollama — small enough for local inference
- 8 tools covering local library + Last.fm APIs with graceful degradation
- Heuristic evals (no LLM judge) for deterministic CI

## Files to Create

- `crates/mt-tauri/src/agent/mod.rs` — module exports, Tauri commands, agent loop
- `crates/mt-tauri/src/agent/tools.rs` — 8 Tool trait implementations
- `crates/mt-tauri/src/agent/types.rs` — AgentResponse, TrackSummary, AgentContext, AgentError
- `crates/mt-tauri/src/agent/prompt.rs` — system prompt constant
- `crates/mt-tauri/src/agent/setup.rs` — Ollama detection, model pull, onboarding state
- `crates/mt-tauri/src/agent/evals.rs` — agent eval suite

## Existing Code to Reuse

- `db::favorites::get_recently_played` — GetRecentlyPlayed tool
- `db::stats::get_top_artists` — GetTopArtists tool
- `db::library::get_all_tracks` — SearchLibrary tool
- `db::library::find_tracks_by_artist_title` — cross-ref for similarity tools
- `LastFmClient::api_call` — all Last.fm tools
- `db::playlists::create_playlist` / `add_tracks_to_playlist` — playlist creation
- `RateLimiter` (via LastFmClient) — rate limiting
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 cargo check --features agent compiles
- [ ] #2 cargo check (without agent) compiles — no regressions
- [ ] #3 cargo nextest run --workspace passes
- [ ] #4 Unit tests for each tool's call() method
- [ ] #5 Agent evals pass with mock Ollama server
<!-- DOD:END -->
