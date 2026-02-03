---
id: task-157
title: Integrate Alpine.js Intersect plugin for album art lazy loading
status: Done
assignee: []
created_date: '2026-01-16 22:19'
updated_date: '2026-02-03 05:52'
labels:
  - frontend
  - alpine.js
  - performance
  - future
dependencies: []
priority: low
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

Integrate Alpine.js's official Intersect plugin (`@alpinejs/intersect`) to enable lazy loading of album artwork when that feature is implemented.

## Current State

The application currently:
- ✅ Loads all track data eagerly (no infinite scroll)
- ✅ Renders all library rows at once (infinite scroll removed)
- ❌ No lazy loading of images or content
- ❌ No intersection-based loading

**Recent Changes:**
- Infinite scroll implementation was reverted (commit 2ba1293)
- `@alpinejs/intersect` plugin preserved for future album art lazy loading
- Library now renders all tracks immediately without pagination

### Potential Performance Issues (Future)

1. **Album art**: Would load all images at once if added
2. **Memory usage**: All album art images loaded upfront
3. **Initial render**: Slow loading of many album artwork images

## Proposed Solution

### Installation
```bash
npm install @alpinejs/intersect
```
✅ **COMPLETED**

### Registration (`main.js`)
```javascript
import Alpine from 'alpinejs';
import intersect from '@alpinejs/intersect';

Alpine.plugin(intersect);
Alpine.start();
```
✅ **COMPLETED**

### Current Album Art Implementation

**Now Playing View**: ✅ Album art is already implemented and displays immediately
- Shows artwork for currently playing track only
- Loads as base64 data, no lazy loading needed
- Single image display, no performance concerns

### Future Use Cases (When Album Art Added to Library)

#### 1. Lazy Load Album Artwork Thumbnails (Primary Use Case)
```html
<template x-for="track in library.filteredTracks" :key="track.id">
  <tr class="library-row">
    <td class="album-art">
      <div
        x-data="{ loaded: false }"
        x-intersect.once="loaded = true"
        class="w-10 h-10 bg-muted"
      >
        <img
          x-show="loaded"
          :src="loaded ? track.albumArt : ''"
          class="w-full h-full object-cover"
          loading="lazy"
        >
      </div>
    </td>
    <!-- other columns -->
  </tr>
</template>
```

#### 2. Analytics / Play Tracking (Optional)
```html
<div
  x-intersect.threshold.50="trackView(track.id)"
>
  <!-- Track has been 50% visible, log impression -->
</div>
```

### Intersect Modifiers

```html
<!-- Trigger once (for lazy loading) -->
<div x-intersect.once="loadImage()">

<!-- Trigger when leaving viewport -->
<div x-intersect:leave="pauseVideo()">

<!-- Custom threshold (0-100%) -->
<div x-intersect.threshold.75="markAsViewed()">

<!-- Custom margin -->
<div x-intersect.margin.200px="preload()">

<!-- Half visible -->
<div x-intersect.half="onHalfVisible()">

<!-- Fully visible -->
<div x-intersect.full="onFullyVisible()">
```

## Implementation Priority

1. **Phase 1**: Wait for album artwork feature implementation
2. **Phase 2**: Add lazy loading to album art images using x-intersect.once
3. **Phase 3**: Test with large libraries containing many albums
4. **Phase 4**: Measure image loading performance improvements

## Note

This is **lower priority** because:
1. Album artwork feature doesn't exist yet
2. Current library has no album art to lazy load
3. Plugin is ready but waiting for album art feature implementation

The intersect plugin foundation is in place and ready for when album artwork is added.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Install and register @alpinejs/intersect plugin
- [x] #2 Remove infinite scroll implementation (reverted)
- [x] #3 Assess album art lazy loading needs (now playing view doesn't need it - single image only)
- [ ] #4 Implement lazy loading for album artwork thumbnails in library view (when added)
- [ ] #5 Test with libraries containing 100+ albums with artwork thumbnails
- [ ] #6 Measure image loading performance improvements
- [ ] #7 Add x-intersect.once to album art lazy loading implementation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Task closed without full implementation. The @alpinejs/intersect plugin was installed and registered, but album art thumbnails in the library view were never added. The plugin remains available if album art is implemented in the future, but this task is being closed as the feature it was intended to support does not exist.
<!-- SECTION:NOTES:END -->
