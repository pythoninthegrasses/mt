---
id: task-177
title: 'Expose additional metadata columns: total tracks, disc #, year, genre'
status: To Do
assignee: []
created_date: '2026-01-20 07:17'
updated_date: '2026-01-28 08:16'
labels:
  - frontend
  - ui
  - metadata
  - columns
dependencies: []
priority: medium
ordinal: 1906.25
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add new columns to the library table to expose additional track metadata. Currently the "index" column shows `track_number` only. The request is to:

1. **Split track number display**: Show track number separately (not combined as "N / total")
2. **Add Total Tracks column**: New column showing `track_total` 
3. **Add Disc # column**: New column showing `disc_number` (and optionally `disc_total`)
4. **Add Year column**: New column showing `year` - **add to default column view to the LEFT of Time**
5. **Add Genre column**: New column showing `genre`

## Current Architecture

**Column definitions** are in `app/frontend/js/components/library-browser.js`:
- `DEFAULT_COLUMN_WIDTHS` - pixel widths per column
- `DEFAULT_COLUMN_VISIBILITY` - which columns are visible by default
- `DEFAULT_COLUMN_ORDER` - column order array
- `baseColumns` - base column definitions (key, label, sortable, minWidth, canHide)
- `extraColumns` - dynamic columns for special views (lastPlayed, dateAdded, playCount)

**Column rendering** is in `app/frontend/index.html`:
- Lines 635-697 contain the `<template x-for="col in columns">` loop
- Each column has a conditional template for rendering (e.g., `x-if="col.key === 'index'"`)

**Metadata structure** (already available from Rust backend):
- `track_number: Option<u32>` - track number 
- `track_total: Option<u32>` - total tracks on album
- `disc_number: Option<u32>` - disc number
- `disc_total: Option<u32>` - total discs  
- `year: Option<u32>` - release year
- `genre: Option<String>` - genre

These fields are already returned by `get_track_metadata` in `src-tauri/src/metadata.rs` and stored in the database.

## Implementation Tasks

1. Add new column definitions to `baseColumns` or `extraColumns` in library-browser.js:
   - `totalTracks` - label "Total", shows `track_total`
   - `disc` - label "Disc", shows `disc_number` (or "disc_number/disc_total" format)
   - `year` - label "Year", shows `year`
   - `genre` - label "Genre", shows `genre`

2. Update `DEFAULT_COLUMN_WIDTHS` with appropriate widths:
   - totalTracks: ~50px
   - disc: ~50px  
   - year: ~60px
   - genre: ~100px

3. Update `DEFAULT_COLUMN_VISIBILITY`:
   - year: true (visible by default per requirements)
   - totalTracks, disc, genre: false (hidden by default, user can enable)

4. Update `DEFAULT_COLUMN_ORDER`:
   - Insert `year` to the LEFT of `duration` (Time)
   - Add other new columns in logical positions

5. Add rendering templates in index.html for each new column:
   ```html
   <template x-if="col.key === 'totalTracks'">
     <span x-text="track.track_total || ''"></span>
   </template>
   <template x-if="col.key === 'disc'">
     <span x-text="track.disc_number || ''"></span>
   </template>
   <template x-if="col.key === 'year'">
     <span x-text="track.year || ''"></span>
   </template>
   <template x-if="col.key === 'genre'">
     <span x-text="track.genre || ''"></span>
   </template>
   ```

6. Add sorting support in `library.js` for new columns (year, genre are already string/number sortable)

7. Verify Python backend returns these fields (check `app/backend/` track model)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New columns available: Total Tracks, Disc #, Year, Genre
- [ ] #2 Year column visible by default, positioned to the LEFT of Time column
- [ ] #3 Other new columns hidden by default but can be enabled via header context menu
- [ ] #4 Column widths appropriate for content (Year ~60px, Genre ~100px)
- [ ] #5 Sorting works correctly for all new columns
- [ ] #6 Column visibility and order persisted in localStorage
- [ ] #7 Existing Playwright column tests still pass
- [ ] #8 New columns render empty string (not 'undefined' or 'null') when metadata missing
<!-- AC:END -->
