---
id: TASK-311
title: >-
  Refactor Genius to preview/refine/approve flow instead of one-shot playlist
  creation
status: To Do
assignee: []
created_date: '2026-04-04 08:59'
updated_date: '2026-04-13 04:00'
labels:
  - genius
  - ux
  - refactor
dependencies: []
references:
  - docs/agent.md
  - docs/genius.md
  - crates/mt-tauri/src/agent/mod.rs
  - app/frontend/js/components/genius-browser.js
priority: medium
ordinal: 50500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently, Genius one-shots playlist creation: the user enters a prompt, the agent generates tracks, and a playlist is immediately persisted to the database. There is no opportunity to preview, refine, or reject the result before it's saved.

Refactor the flow into a multi-step dialogue:

1. **Generate** — User submits a prompt, agent generates a candidate track list (as today)
2. **Preview** — Display the candidate tracks in the UI *without* persisting to the database. User can see track names, artists, and any other relevant metadata
3. **Refine** — User can provide feedback (e.g., "remove the jazz tracks", "add more Radiohead", "make it longer") which triggers another agent turn to revise the candidate list. This can repeat multiple times
4. **Approve** — User explicitly approves the final track list, at which point the playlist is created in the database

### Backend changes (Rust)

- Split `agent_generate_playlist` into two phases:
  - **Generate/refine phase**: Returns a candidate `AgentResponse` with track list but does NOT persist to database
  - **Approve phase**: New Tauri command (e.g., `agent_approve_playlist`) that accepts the finalized track IDs and creates the playlist
- Support multi-turn refinement: the agent needs conversational context (prior turns) to refine intelligently. Consider whether to maintain session state in the backend or pass conversation history from the frontend
- `shuffle_spread_artists()` should run at approve time, not generate time

### Frontend changes (Alpine.js)

- After generation, show a preview panel with the candidate tracks (not a toast)
- Provide UI for:
  - Approving the playlist (triggers persist)
  - Entering refinement feedback (triggers another agent turn with context)
  - Canceling/discarding the candidate
- Track list in preview should show enough metadata for the user to evaluate quality (title, artist, album, duration)
- Consider drag-to-reorder or remove-individual-tracks in the preview

### Key files

- `crates/mt-tauri/src/agent/mod.rs` — agent orchestration, `agent_generate_playlist`, `parse_agent_response`, `shuffle_spread_artists`
- `app/frontend/js/components/genius-browser.js` — Alpine.js component, generation flow
- `app/frontend/js/api/agent.js` — Tauri IPC bridge
- `app/frontend/views/genius.html` — Genius view template
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Submitting a Genius prompt returns a candidate track list without creating a playlist in the database
- [ ] #2 Candidate tracks are displayed in a preview panel showing title, artist, album, and duration
- [ ] #3 User can enter refinement feedback that sends another agent turn with conversational context, updating the preview
- [ ] #4 Refinement can be repeated multiple times before approving
- [ ] #5 User can approve the candidate, which persists the playlist to the database and emits PlaylistsUpdatedEvent
- [ ] #6 User can discard/cancel a candidate without any database side effects
- [ ] #7 shuffle_spread_artists runs at approve time, not generate time
- [ ] #8 Existing one-shot behavior is fully replaced (no legacy path)
<!-- AC:END -->
