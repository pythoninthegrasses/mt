---
id: task-252
title: Unified column width defaults with smarter distribution algorithm
status: Done
assignee: []
created_date: '2026-02-04 06:45'
updated_date: '2026-02-04 07:53'
labels:
  - frontend
  - ux
  - columns
  - settings
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Added a new Columns section to Settings for managing column layout preferences, with selective reset options and confirmation dialog.

**Note:** The original plan included changes to the column width distribution algorithm for consistent widths across views. This was implemented but then reverted per user request - the original proportional distribution behavior was preferred. The Settings UI additions were kept.

## What Was Implemented

1. **Settings Page - Columns Section** - New section with:
   - Current layout preview (visible/hidden column counts, custom order indicator)
   - Selective reset options (checkboxes for widths, order, visibility, sort)
   - Reset button that applies selected options
   - Quick tip about right-click header menu

2. **Confirmation Dialog** - Reset via context menu or Settings shows confirmation dialog
   - Uses Tauri native dialog when available, falls back to browser confirm
   - Can be disabled via Settings toggle (default: ON)
   - When disabled, reset happens immediately

3. **Metro-Teal Theme Contrast** - Added CSS for better visibility of settings panels in dark theme

## Files Modified

- `app/frontend/js/components/library-browser.js` - Added `confirmResetColumnDefaults()` method, event listener for settings reset
- `app/frontend/js/components/settings-view.js` - Added column settings state and methods
- `app/frontend/views/settings.html` - Added Columns nav item and section content
- `app/frontend/js/stores/ui.js` - Added 'columns' to valid settings sections
- `app/frontend/styles.css` - Added metro-teal contrast for settings panels
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Settings page has new Columns section with layout preview and selective reset options
- [x] #2 Reset via context menu shows confirmation dialog (when enabled in settings)
- [x] #3 Confirmation toggle in Settings allows disabling the reset dialog for immediate reset
- [x] #4 Metro-teal theme has proper contrast for settings panel backgrounds
- [x] #5 All existing tests pass (223 Vitest tests)
<!-- AC:END -->
