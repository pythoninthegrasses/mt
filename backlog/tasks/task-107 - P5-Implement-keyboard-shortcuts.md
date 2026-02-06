---
id: task-107
title: 'P5: Implement keyboard shortcuts'
status: Done
assignee: []
created_date: '2026-01-12 04:09'
updated_date: '2026-02-06 03:57'
labels:
  - frontend
  - ux
  - phase-5
milestone: Tauri Migration
dependencies:
  - task-101
priority: medium
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add keyboard shortcuts for common actions.

**Shortcuts to implement:**
- `Space`: Play/pause
- `→`: Next track (or seek forward 5s with modifier)
- `←`: Previous track (or seek back 5s with modifier)
- `↑`: Volume up
- `↓`: Volume down
- `M`: Mute/unmute
- `L`: Toggle loop mode
- `S`: Toggle shuffle
- `Cmd+F` / `Ctrl+F`: Focus search
- `Escape`: Clear search / close dialogs
- `Delete` / `Backspace`: Remove selected from queue
- `Cmd+D`: Queue next (add selected track to play next in queue)
- `Cmd+S`: Stop after currently playing track

**Context-aware shortcuts:**
The following shortcuts should only be active in library and playlist views, NOT in Now Playing:
- `Cmd+D` (Queue next)
- `Cmd+S` (Stop after current)

These shortcuts require a track selection context to operate on.

**Settings UI:**
Expose all keyboard shortcuts in the Settings panel under a "Keyboard Shortcuts" section. Display the shortcut key combinations and their actions in a readable format. Consider making shortcuts customizable in a future iteration.

**Implementation:**
```javascript
// src/js/shortcuts.js
document.addEventListener('keydown', (e) => {
    // Ignore if typing in input
    if (e.target.tagName === 'INPUT') return;
    
    switch(e.code) {
        case 'Space':
            e.preventDefault();
            Alpine.store('player').toggle();
            break;
        case 'ArrowRight':
            if (e.metaKey || e.ctrlKey) {
                Alpine.store('player').seek(Alpine.store('player').progress + 5);
            } else {
                Alpine.store('player').next();
            }
            break;
        case 'KeyD':
            if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                // Queue next - only in library/playlist views
                if (!isNowPlayingView()) {
                    queueSelectedTrackNext();
                }
            }
            break;
        case 'KeyS':
            if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                // Stop after current - only in library/playlist views
                if (!isNowPlayingView()) {
                    Alpine.store('player').stopAfterCurrent();
                }
            }
            break;
        // ... etc
    }
});
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Space toggles playback
- [x] #2 Arrow keys navigate tracks
- [x] #3 Volume keys work
- [x] #4 Cmd+F focuses search
- [x] #5 Shortcuts don't interfere with text input

- [x] #6 Cmd+D queues selected track to play next (library/playlist views only)
- [x] #7 Cmd+S enables stop after currently playing track (library/playlist views only)
- [x] #8 Context-aware shortcuts are disabled in Now Playing view
- [x] #9 Keyboard shortcuts section visible in Settings UI
- [x] #10 All shortcuts listed with their key combinations in Settings
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Platform modifier key:** Use `Cmd` on macOS and `Ctrl` on Linux/Windows for all modifier shortcuts (Cmd+F, Cmd+D, Cmd+S, etc.).
<!-- SECTION:NOTES:END -->
