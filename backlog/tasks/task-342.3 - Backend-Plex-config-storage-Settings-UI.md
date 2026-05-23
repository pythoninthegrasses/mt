---
id: TASK-342.3
title: 'Backend: Plex config storage + Settings UI'
status: Done
assignee: []
created_date: '2026-05-21 22:57'
updated_date: '2026-05-23 01:12'
labels: []
dependencies:
  - TASK-342.2
parent_task_id: TASK-342
ordinal: 55500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement Plex configuration storage and settings UI.

**Backend (Rust/Tauri commands):**
- Store Plex config in the existing `settings.json` store (same mechanism as Last.fm settings)
- Namespaced key: `plex.config`
- Fields: `url` (string), `token` (string), `libraries` (optional list of library name filters)
- Commands: `plex_config_set`, `plex_config_get`, `plex_config_clear`, `plex_server_ping`
- Token masking in get response: show first 4 + last 4 chars

**Frontend (Settings UI):**
- New Settings > Plex section (follow existing settings layout pattern)
- URL input field (text)
- Token input field (password type)
- Library multi-select checkboxes (fetched from server via ping endpoint)
- Connect button (validates + saves), Disconnect button (clears config)
- Connection status toast (success/error)

**Sidebar:**
- Show 'Plex' section in sidebar navigation when config is present
- Hidden when config is cleared

Reference: Last.fm settings implementation in `settings-lastfm.html` and `commands/lastfm.rs` for the pattern.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Plex config is stored via `app.store("settings.json")` (the Tauri-plugin-store backing `network_cache_enabled` in `crates/mt-tauri/src/commands/audio.rs:472-477`), under the key `plex.config`. (Note: the task description's "same mechanism as Last.fm settings" is inaccurate — Last.fm uses the SQLite `settings` table; the canonical Plex mechanism is the JSON store.)
- [x] #2 Stored shape: `{ "url": String, "token": String, "libraries": Option<Vec<String>>, "client_identifier": String }`. `client_identifier` is a UUIDv4 generated once on first set and persisted; never regenerated unless config is cleared. Matches AC #3 on TASK-342.1.
- [x] #3 Tauri command `plex_config_set(url: String, token: String, libraries: Option<Vec<String>>)` validates `url` is non-empty and parseable by `reqwest::Url::parse`, then writes the JSON store. If `client_identifier` is absent from the existing config, a new UUIDv4 is generated and written alongside the other fields.
- [x] #4 Tauri command `plex_config_get() -> Result<PlexConfigResponse, String>` returns the config with `token` masked to `first 4 + "…" + last 4` chars (e.g., `abcd…wxyz`). If the token is shorter than 12 chars, return `"…"`. `url`, `libraries`, and `client_identifier` are returned verbatim. Returns a "not configured" variant (e.g., `Ok(PlexConfigResponse::NotConfigured)`) when the key is absent.
- [x] #5 Tauri command `plex_config_clear()` deletes the `plex.config` key entirely (removing `client_identifier` too — a cleared config starts fresh on reconnect).
- [x] #6 Tauri command `plex_server_ping(url: String, token: String) -> Result<PlexPingResponse, String>` performs `GET /identity` with a 5-second timeout, expecting `200` + `MediaContainer.machineIdentifier` + `MediaContainer.friendlyName` in the JSON. Returns `Ok(PlexPingResponse { server_name, machine_id, version })` on success, `Err(...)` mapping `401 → "Invalid token"`, `timeout → "Server unreachable"`, other → `"Connection failed: <details>"`.
- [x] #7 Tauri command `plex_list_libraries(url: String, token: String) -> Result<Vec<PlexLibrarySummary>, String>` issues `GET /library/sections` with the supplied credentials (does not require config to be saved first) and returns music sections only (`type == "artist"`) as `{ key, title }` pairs. Used by the Settings UI to populate the library multi-select before save.
- [x] #8 Frontend: new file `app/frontend/views/settings-plex.html` mirroring the structure of `settings-lastfm.html`. Contains: URL text input, token password input, "Discover libraries" button (calls `plex_list_libraries`), library checkboxes (populated from the discover response), Connect button (calls `plex_server_ping` then `plex_config_set`), Disconnect button (calls `plex_config_clear`). Shows server name + machine ID after successful ping.
- [x] #9 The Plex tab is wired into `settings.html` between the Last.fm and Stats panes, following the existing tabbed-settings pattern (Alpine `x-data` selector + tab buttons).
- [x] #10 The sidebar is NOT modified by this task — Plex content surfaces through the existing artists/albums/library views via the TASK-342.4 merge, not via a dedicated sidebar section. The Alpine `Alpine.store('settings').plex_configured` flag is populated at app startup (calling `plex_config_get` and checking for the configured variant with a non-empty `url`) and is consumed by the Settings UI in this task and by the cloud-badge logic in TASK-342.6.
- [x] #11 Unit tests: (a) `plex_config_set` followed by `plex_config_get` round-trips, with the token masked in the response and the raw token still readable internally; (b) `plex_config_clear` removes the key (verified by `plex_config_get` returning the "not configured" variant); (c) `plex_server_ping` against a wiremock server returning `200` + `machineIdentifier` returns Ok with the parsed server name; (d) `plex_server_ping` against a wiremock returning `401` returns `Err("Invalid token")`.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Plex config storage (5 Tauri commands: plex_config_set/get/clear/ping/list_libraries) with tauri-plugin-store, wiremock integration tests, and full frontend: settings store with plex_configured flag, settings-view plex state/methods, settings-plex.html partial, wired into settings.html between Last.fm and Stats.
<!-- SECTION:FINAL_SUMMARY:END -->
