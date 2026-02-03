---
id: task-155
title: >-
  Integrate Alpine.js Collapse plugin for animated sidebar and accordion
  transitions
status: Done
assignee: []
created_date: '2026-01-16 22:19'
updated_date: '2026-02-03 05:51'
labels:
  - frontend
  - alpine.js
  - animation
  - refactor
dependencies: []
priority: low
ordinal: 26500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

Integrate Alpine.js's official Collapse plugin (`@alpinejs/collapse`) to provide smooth, JavaScript-driven height animations for collapsible elements like the sidebar and any future accordion components.

## Current State

The sidebar collapse uses CSS-based width transitions:

### Sidebar (`index.html` + `sidebar.js`)
```html
<aside 
  x-data="sidebar"
  class="relative flex flex-col bg-sidebar border-r border-border transition-all duration-300 ease-in-out"
  :style="{ width: isCollapsed ? '48px' : width + 'px' }"
>
```

### CSS Transitions
```css
.transition-all {
  transition-property: all;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}

.duration-300 {
  transition-duration: 300ms;
}
```

### Limitations of Current Approach

1. **Width vs Height**: CSS cannot animate `height: auto` smoothly
2. **Content overflow**: Content can flash during width transitions
3. **No content-aware sizing**: Must manually set widths

## Proposed Solution

### Installation
```bash
npm install @alpinejs/collapse
```

### Registration (`main.js`)
```javascript
import Alpine from 'alpinejs';
import collapse from '@alpinejs/collapse';

Alpine.plugin(collapse);
Alpine.start();
```

### Use Cases

#### 1. Sidebar Section Collapse (Playlist Groups)
```html
<div x-data="{ expanded: true }">
  <button @click="expanded = !expanded" class="flex items-center">
    <span>Playlists</span>
    <svg :class="{ 'rotate-180': expanded }" class="transition-transform">
      <!-- chevron icon -->
    </svg>
  </button>
  
  <div x-show="expanded" x-collapse>
    <template x-for="playlist in playlists">
      <a :href="playlist.url" x-text="playlist.name"></a>
    </template>
  </div>
</div>
```

#### 2. Track Details Expansion
```html
<div class="track-row">
  <div class="track-info">Title - Artist</div>
  <button @click="showDetails = !showDetails">
    <svg :class="{ 'rotate-180': showDetails }"><!-- expand icon --></svg>
  </button>
</div>

<div x-show="showDetails" x-collapse.duration.300ms>
  <div class="track-details p-4 bg-muted">
    <p>Album: ...</p>
    <p>Duration: ...</p>
    <p>File: ...</p>
  </div>
</div>
```

#### 3. Settings Accordion (Future)
```html
<div x-data="{ activeSection: null }">
  <template x-for="section in ['General', 'Playback', 'Library', 'Appearance']">
    <div>
      <button 
        @click="activeSection = activeSection === section ? null : section"
        class="w-full flex justify-between p-3"
      >
        <span x-text="section"></span>
        <svg :class="{ 'rotate-180': activeSection === section }">
          <!-- chevron -->
        </svg>
      </button>
      
      <div x-show="activeSection === section" x-collapse>
        <!-- Section settings content -->
      </div>
    </div>
  </template>
</div>
```

### Collapse Modifiers

```html
<!-- Custom duration -->
<div x-show="open" x-collapse.duration.500ms>

<!-- Minimum height (for partial collapse) -->
<div x-show="open" x-collapse.min.50px>
```

## Projected Value

| Metric | Before | After |
|--------|--------|-------|
| Height animation support | None (width only) | Full |
| Lines of animation code | CSS classes | 1 directive |
| Content-aware sizing | Manual | Automatic |
| Accordion pattern | Would need custom JS | Declarative |

## Future Applications

- **Playlist groups**: Collapsible sections for "Recently Added", "Favorites", etc.
- **Track metadata**: Expand to show full details in library view
- **Settings page**: Accordion-style sections
- **Queue sections**: Collapse "Up Next" vs "History"

## Note

This is lower priority because:
1. Current sidebar uses width animation (works fine)
2. No accordion patterns currently exist in the UI
3. Main value is for future features
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Install and register @alpinejs/collapse plugin
- [ ] #2 Identify existing collapsible UI elements that could benefit
- [ ] #3 Implement x-collapse on at least one component (sidebar sections or track details)
- [ ] #4 Verify smooth height animations work correctly
- [ ] #5 Test with different content lengths
- [ ] #6 Document pattern for future accordion/collapsible components
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Complexity: MEDIUM

**Effort estimate**: ~1-2 hours

**Key challenges**:
- No accordion patterns currently exist in the UI
- Would need to find or create collapsible sections first
- Notes indicate "lower priority because current sidebar uses width animation (works fine)"
- Once target element is found, implementation is simple (just add `x-collapse` to existing `x-show`)

**Simplest path**:
1. Install + register plugin (5 min)
2. Identify or create a collapsible section (30-45 min)
3. Add `x-collapse` directive (5 min)
4. Test and verify smooth animations (10-15 min)

Task closed without implementation. The feature was deemed low priority as the current sidebar width animation works adequately and no accordion patterns currently exist in the UI.
<!-- SECTION:NOTES:END -->
