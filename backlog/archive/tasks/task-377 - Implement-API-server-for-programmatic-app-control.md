---
id: TASK-377
title: Implement API server for programmatic app control
status: Done
assignee:
  - '@lance'
created_date: '2025-10-12 07:10'
updated_date: '2025-10-12 07:26'
labels: []
dependencies: []
---

## Description

Add a socket-based API server to enable programmatic control of the mt app, allowing LLMs and automation tools to interact with the frontend. This solves pain points around testing and automation by providing direct access to player controls, UI navigation, track selection, slider adjustments, and media key simulation.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Implement socket-based API server on configurable port (default 5555)
- [x] #2 Create JSON-based command/response protocol with error handling
- [x] #3 Add playback control commands (play, pause, stop, next, previous)
- [x] #4 Add track selection and queue management commands
- [x] #5 Add UI navigation commands (switch views, select items in library/queue)
- [x] #6 Add slider control commands (volume adjustment, seek position)
- [x] #7 Add media key simulation support
- [x] #8 Ensure thread-safe command execution on main UI thread
- [x] #9 Add configuration option to enable/disable API server
- [x] #10 Implement localhost-only security by default
- [x] #11 Create API documentation with example commands
- [x] #12 Integrate with existing Eliot logging system
- [x] #13 Add example client scripts for common operations
<!-- AC:END -->
