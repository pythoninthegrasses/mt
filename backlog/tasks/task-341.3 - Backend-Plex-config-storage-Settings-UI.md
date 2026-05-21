---
id: TASK-341.3
title: 'Backend: Plex config storage + Settings UI'
status: To Do
assignee: []
created_date: '2026-05-21 22:57'
labels: []
dependencies:
  - TASK-341.2
parent_task_id: TASK-341
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
- [ ] #1 Tauri command `plex_config_set(url, token, libraries)` persists config to settings store under key `plex.config`
- [ ] #2 Tauri command `plex_config_get()` returns current config with token masked (first 4 + last 4 chars visible)
- [ ] #3 Tauri command `plex_config_clear()` removes stored Plex config
- [ ] #4 Tauri command `plex_server_ping(url, token)` returns Ok if server is reachable and token is valid, Err otherwise
- [ ] #5 Settings > Plex page shows: URL input, token input (password field), library multi-select checkboxes, Connect/Disconnect buttons
- [ ] #6 On Connect: calls plex_server_ping, shows success toast with server name, or error toast with reason
- [ ] #7 Sidebar shows 'Plex' navigation section when config is present, hidden when cleared
- [ ] #8 Plex config is loaded from settings store at app startup
- [ ] #9 Unit tests for config persistence, retrieval with masking, and server ping
<!-- AC:END -->
