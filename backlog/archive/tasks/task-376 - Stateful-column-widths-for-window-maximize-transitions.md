---
id: TASK-376
title: Stateful column widths for window maximize transitions
status: Done
assignee: []
created_date: '2025-10-12 02:47'
updated_date: '2025-10-12 02:55'
labels: []
dependencies: []
---

## Description

Column widths should adapt intelligently when window is maximized/unmaximized. In unmaximized mode, preserve current column widths. In full screen/maximized mode, pin the first and last columns to their respective corners while expanding middle columns dynamically based on viewport size (e.g., Title column should use ~33% of available width).

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Column widths are preserved when returning to unmaximized state
- [x] #2 First column pinned to left edge in maximized mode
- [x] #3 Last column pinned to right edge in maximized mode
- [x] #4 Middle columns (especially Title) expand proportionally in maximized mode (e.g., Title ~33% of viewport)
- [x] #5 State transitions smoothly when toggling between maximize/unmaximize
<!-- AC:END -->

## Implementation Notes

Implemented stateful column widths for window maximize transitions. Key changes:

1. **StoplightButtons** (core/stoplight.py):
   - Added on_state_change callback parameter to **init**
   - Modified toggle_maximize() to notify callback when window state changes
   - Callback is triggered after geometry changes with 100ms delay for maximized state

2. **QueueView** (core/gui.py):
   - Added on_window_state_change() method to handle maximize/unmaximize events
   - Added _apply_maximized_column_widths() to calculate dynamic widths based on viewport
   - Stores unmaximized widths in _unmaximized_column_widths before applying dynamic widths
   - Restores saved widths when returning to unmaximized state
   - Dynamic width distribution: track=50px, title=33%, artist=33%, album=remainder, year=80px

3. **SearchBar** (core/gui.py):
   - Modified setup_search_bar() to pass on_window_state_change callback to StoplightButtons

4. **MusicPlayer** (core/player.py):
   - Added on_window_state_change() method to forward events to queue_view
   - Added callback to SearchBar initialization in setup_components()

The implementation ensures smooth transitions with column widths preserved across state changes and comprehensive Eliot logging for all operations.
