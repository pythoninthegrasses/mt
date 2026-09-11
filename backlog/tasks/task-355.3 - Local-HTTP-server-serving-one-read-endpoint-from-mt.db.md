---
id: TASK-355.3
title: Local HTTP server serving one read endpoint from mt.db
status: To Do
assignee: []
created_date: '2026-09-11 00:39'
labels: []
dependencies:
  - TASK-355.2
parent_task_id: TASK-355
type: task
ordinal: 60500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Zig sidecar needs a transport the frontend can reach directly. HTTP on loopback is chosen over stdio specifically because the frontend must be able to call the sidecar without going back through Rust -- if the transport were stdio-only, every one of the ~100 commands that could otherwise move to the sidecar would remain a permanent Rust proxy, defeating the purpose of the migration. app/frontend/js/api/shared.js already has a dormant HTTP client shape (API_BASE constant, request() helper, ApiError class) built for exactly this. Security note: binding to 127.0.0.1 (not 0.0.0.0) does not trigger the macOS firewall prompt, but loopback alone is not a security boundary -- any local process can still connect -- so a bearer token is required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Zig server binds 127.0.0.1 on an ephemeral (OS-assigned) port, never a hardcoded port
- [ ] #2 The chosen port and a randomly generated bearer token are written to a file in the app data directory with 0600 permissions
- [ ] #3 Requests without a valid bearer token are rejected
- [ ] #4 One real library read endpoint returns correct data queried from an actual mt.db file
- [ ] #5 JSON responses are streamed to the response writer rather than materialized as an in-memory tree first
- [ ] #6 Tests cover: successful auth, rejected auth (missing and invalid token), and a malformed request
<!-- AC:END -->
