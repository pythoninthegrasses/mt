---
id: task-255
title: Type-to-jump artist navigation in library view
status: In Progress
assignee: []
created_date: '2026-02-05 06:37'
updated_date: '2026-02-06 00:16'
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

- [x] #8 Respects 'ignore words' setting from Settings > Sorting (uses sortIgnoreWordsList)
- [x] #9 Default ignore words include: the, a, an, la, le, les, los, las, el, die, der, das, il, lo, i, gli
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Fix: Priority-based matching in jumpToMatchingArtist

**Root cause:** The original `jumpToMatchingArtist()` used a single `.find()` call that iterated through tracks in order, treating all match types equally. A word-boundary match on "Laulan" (in "Konami Kukeiha Club - Yoann Laulan") at track index 19 was found before the stripped-prefix match on "The La's" at track index 268.

**Fix:** Replaced single-pass `.find()` with a priority-based search:
1. **Priority 1** (highest): Stripped prefix match — e.g., "The La's" → strip "the " → "la's" starts with "la"
2. **Priority 2**: Full artist name starts with query — e.g., "La Dispute" starts with "la"
3. **Priority 3** (lowest): Word boundary match — e.g., "Yoann Laulan" has word starting with "la"

The loop breaks immediately on priority 1 match. For lower priorities, it records the first match but keeps scanning for higher-priority matches.

**The `DEFAULT_SORT_IGNORE_WORDS` fallback was already working correctly** — `sortIgnoreWordsList?.trim() || DEFAULT_SORT_IGNORE_WORDS` properly falls back when the stored value is empty string.
<!-- SECTION:NOTES:END -->
