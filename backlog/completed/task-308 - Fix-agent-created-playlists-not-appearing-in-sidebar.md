---
id: TASK-308
title: Fix agent-created playlists not appearing in sidebar
status: Done
assignee: []
created_date: '2026-04-02 21:38'
updated_date: '2026-04-02 21:42'
labels:
  - bug
  - playlists
  - agent
  - frontend
  - tauri
dependencies: []
references:
  - /Users/lance/git/mt/crates/mt-tauri/src/agent/mod.rs
  - /Users/lance/git/mt/app/frontend/js/components/genius-browser.js
  - /Users/lance/git/mt/app/frontend/js/components/sidebar.js
  - /Users/lance/git/mt/app/frontend/js/events.js
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Investigate and fix the refresh path so playlists created by the Genius/agent flow appear in the sidebar immediately after successful creation. Backend logs already show the playlist is created and persisted, so the task is to restore visibility and update propagation between the agent flow and playlist UI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A playlist created successfully through the Genius/agent flow appears in the sidebar without requiring an app restart.
- [x] #2 Agent-created playlists trigger the same playlist update propagation path used by other playlist creation flows, or an equivalent path with matching observable behavior.
- [x] #3 Automated test coverage reproduces the missing-refresh case and passes after the fix.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: the agent/Genius flow created playlists successfully, but the sidebar maintained its own playlist list and never subscribed to the local `mt:playlists-updated` browser event that Genius dispatches after success. The backend agent path also did not emit the standard Tauri `playlists:updated` event used by normal playlist CRUD commands.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a sidebar listener for `mt:playlists-updated` with cleanup in `destroy()`, so agent-created playlists now reload into the sidebar immediately.

Added a frontend regression test proving the sidebar reloads playlists when `mt:playlists-updated` fires after init.

Aligned the Rust agent playlist creation path with standard playlist behavior by emitting `PlaylistsUpdatedEvent::created` after successful agent playlist creation.
<!-- SECTION:FINAL_SUMMARY:END -->
