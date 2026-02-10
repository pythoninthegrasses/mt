---
id: task-260
title: 'Fix Last.fm settings buttons: blocking, theme highlight, sizing'
status: In Progress
assignee: []
created_date: '2026-02-10 06:10'
updated_date: '2026-02-10 06:22'
labels:
  - bug
  - ui
  - lastfm
  - theming
dependencies: []
priority: high
ordinal: 10125
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three issues with the Last.fm loved tracks buttons ("Sync from Last.fm", "Check for New Matches", "Direct Import") in the settings panel:

**1. Main thread blocking (bug)**
`lastfm_match_loved_tracks` at `crates/mt-tauri/src/commands/lastfm.rs:877` is a synchronous Tauri command. It loops over every unmatched track doing multiple `db.with_conn()` calls per iteration, freezing the UI. Likely affects the other two buttons as well since they also do blocking DB work inside async handlers.

**Fix:** Convert to `pub async fn` and wrap the DB loop in `tokio::task::spawn_blocking`. `Database` is already `#[derive(Clone)]` with `Arc<DbPool>`, so `db.inner().clone()` works for moving into the closure.

**2. No hover highlight in metro-teal theme (styling)**
Buttons use `hover:bg-muted/50`. In metro-teal, `--muted: 0 0% 15%` on `--background: 0 0% 12%` — only 3% lightness difference at 50% opacity, making hover invisible. Light theme has visible hover since the contrast is higher.

**Fix:** Add metro-teal-specific hover rule in `app/frontend/styles.css`:
```css
[data-theme-preset='metro-teal'] [data-testid='settings-view'] button.border-border:hover {
  background-color: rgba(0, 183, 195, 0.15) !important;
  border-color: rgba(0, 183, 195, 0.4) !important;
}
```

**3. Buttons stretch full-width, don't look clickable (styling)**
All three buttons have `w-full` class, spanning the container width and looking like panels rather than buttons. Need equal padding and auto-width.

**Fix:** Remove `w-full` from all three buttons in `app/frontend/views/settings.html:775-805`. The existing `px-4` gives equal 16px left/right padding.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Clicking 'Check for New Matches' does not freeze/block the UI
- [ ] #2 Hovering over buttons in metro-teal theme shows visible teal highlight
- [ ] #3 Buttons are not full-width — they should be shrunk to content with equal left/right padding
- [ ] #4 All three buttons remain functional (sync, match, import)
- [ ] #5 E2E tests pass (buttons use data-testid selectors)
<!-- AC:END -->
