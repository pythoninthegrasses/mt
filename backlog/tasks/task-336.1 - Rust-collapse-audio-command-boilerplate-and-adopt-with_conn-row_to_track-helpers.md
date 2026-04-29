---
id: TASK-336.1
title: >-
  Rust: collapse audio command boilerplate and adopt with_conn / row_to_track
  helpers
status: To Do
assignee: []
created_date: '2026-04-29 04:20'
labels:
  - refactor
  - rust
  - complexity
dependencies: []
references:
  - 'https://github.com/pythoninthegrass/mt/commit/4ba8be8'
parent_task_id: TASK-336
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Highest-leverage Rust complexity wins identified during the PR #44 follow-up audit. Estimated ~150 LOC reduction. All extractions reuse helpers that already exist in the codebase — no new abstractions are introduced.

**Scope:**

1. **`crates/mt-tauri/src/commands/audio.rs:519-577`** — seven Tauri command wrappers (`audio_play`, `audio_pause`, `audio_stop`, `audio_seek`, `audio_set_volume`, `audio_get_volume`, `audio_get_status`) each manually create an `mpsc::channel`, call `state.send_command(...)`, and `recv().map_err(...)`. Replace with a generic helper such as `fn dispatch<R>(state: &AudioState, build: impl FnOnce(Sender<R>) -> AudioCommand) -> ...` plus a thin macro/closure for the `Result<(), String>` flavour. Cuts ~50 LOC.

2. **`crates/mt-tauri/src/commands/audio.rs:283-355`** — the `audio_thread` `match` arms for `Play`/`Pause`/`Seek`/`SetDevice` repeat `ensure_engine().and_then(|eng| eng.X().map_err(...))` then `reply.send(result)`. Collapse via a small closure inside `audio_thread`. `Stop`/`SetVolume`/`GetVolume`/`GetStatus` have different shapes — leave them alone. Cuts ~30 LOC.

3. **`crates/mt-tauri/src/commands/queue.rs` and `crates/mt-tauri/src/commands/favorites.rs`** — migrate the ~100 sites that currently do `let conn = db.conn().map_err(|e| e.to_string())?;` followed by `some_call(&conn).map_err(|e| e.to_string())?` to the existing `Database::with_conn` helper at `crates/mt-tauri/src/db/mod.rs:190`. Pattern is already proven in `crates/mt-tauri/src/commands/lastfm.rs` (33 call sites). Cuts ~70 LOC.

4. **`crates/mt-tauri/src/db/favorites.rs` and `crates/mt-tauri/src/db/playlists.rs`** — make `db::library::row_to_track` `pub(crate)` (currently private in `crates/mt-tauri/src/db/library.rs`) and replace the four inlined ~25-line `Track { id, filepath, title, ... }` row mappings. Cuts ~80 LOC.

**Files to modify:**
- `crates/mt-tauri/src/commands/audio.rs`
- `crates/mt-tauri/src/commands/queue.rs`
- `crates/mt-tauri/src/commands/favorites.rs`
- `crates/mt-tauri/src/db/library.rs` (visibility change only)
- `crates/mt-tauri/src/db/favorites.rs`
- `crates/mt-tauri/src/db/playlists.rs`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Audio command wrappers in commands/audio.rs use a shared dispatch helper; total file LOC reduced by ≥40
- [ ] #2 audio_thread match arms for Play/Pause/Seek/SetDevice share a helper closure; behavior unchanged
- [ ] #3 commands/queue.rs and commands/favorites.rs use Database::with_conn instead of manual db.conn().map_err(...) acquisitions
- [ ] #4 db::library::row_to_track is pub(crate) and reused by db/favorites.rs and db/playlists.rs in place of inlined Track row mappings
- [ ] #5 cargo nextest run --workspace passes
- [ ] #6 cargo clippy --workspace --all-targets passes with -D warnings
- [ ] #7 cargo fmt --all leaves no diff
- [ ] #8 Manual smoke: app launches, plays a track, pause/seek/volume work, favorites toggle works, queue add/remove works
<!-- AC:END -->
