---
id: task-255
title: Type-to-jump artist navigation in library view
status: In Progress
assignee: []
created_date: '2026-02-05 06:37'
updated_date: '2026-02-05 15:18'
labels:
  - frontend
  - ux
  - keyboard-navigation
dependencies: []
priority: medium
ordinal: 10500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add keyboard-driven artist navigation in the music library view. When a track is selected and the user types characters, jump to the first artist matching the typed prefix at a word boundary.

**Behavior:**
1. User selects any track in the music library view (or just focuses the library)
2. User types one or more characters (e.g., "dead", "deadm")
3. Library scrolls to and highlights the first artist matching the typed characters
4. Matching is case-insensitive and matches word boundaries
5. As more characters are typed, the match refines (e.g., "dead" → Deadmau5, "death" → Death from Above)

**Matching examples:**
- "dead" → Deadmau5, Dead Can Dance, Death from Above (whichever comes first alphabetically)
- "deadm" → Deadmau5
- "death f" → Death from Above 1979
- Matching should be case-insensitive: "dead" matches "Deadmau5" and "DEAD CAN DANCE"

**Debounce behavior:**
- Accumulate typed characters into a search buffer
- After typing stops for 500ms-1000ms (use whichever is easier to implement), clear the buffer
- Each keystroke resets the debounce timer
- This allows rapid typing of multi-character prefixes

**Navigation behavior:**
- Scroll the matching artist into view
- Highlight/select the first track by that artist
- Use similar scroll-into-view logic as double-clicking the currently playing track in the bottom bar

**Edge cases:**
- If no match found, do nothing (or show subtle feedback)
- Ignore modifier keys (Cmd, Ctrl, Alt, Shift alone)
- Don't trigger when focus is in an input field (search box, etc.)
- Only active in library view, not Now Playing or playlist views

**Implementation hints:**
- Look at the double-click navigation logic in the player bar for scroll behavior
- Use a simple prefix/startsWith match on artist names at word boundaries
- Consider using `requestAnimationFrame` or `setTimeout` for debouncing
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Typing characters in library view jumps to matching artist
- [x] #2 Matching is case-insensitive
- [x] #3 Matching works on word boundaries (e.g., 'death' matches 'Death from Above')
- [x] #4 Debounce clears search buffer after 500ms of no typing
- [x] #5 Scroll behavior matches double-click on currently playing track
- [x] #6 Does not trigger when typing in input fields
- [x] #7 Only active in music library view

- [ ] #8 Respects 'ignore words' setting from Settings > Sorting (uses sortIgnoreWordsList)
- [ ] #9 Default ignore words include: the, a, an, la, le, les, los, las, el, die, der, das, il, lo, i, gli
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Issue: Default ignore words fallback not working

When `sortIgnoreWordsList` is empty but `sortIgnoreWords` is enabled, the fallback to `DEFAULT_SORT_IGNORE_WORDS` is not being applied correctly. Typing "la" jumps to "Konami" instead of "The La's".

**Current implementation** in `stripIgnoredPrefix()`:
```javascript
const wordsList = uiStore.sortIgnoreWordsList?.trim() || DEFAULT_SORT_IGNORE_WORDS;
```

**To investigate**:
- Verify the constant is being imported correctly at runtime
- Check if the fallback logic triggers when the list is empty
- May need to debug in the running app to see actual values
<!-- SECTION:NOTES:END -->
