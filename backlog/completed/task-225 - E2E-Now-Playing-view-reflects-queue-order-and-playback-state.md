---
id: task-225
title: 'E2E: Now Playing view reflects queue order and playback state'
status: Done
assignee: []
created_date: '2026-01-27 23:37'
updated_date: '2026-01-28 03:45'
labels:
  - e2e
  - playback
  - queue
  - ui
  - P0
dependencies: []
priority: high
ordinal: 4906.25
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Validate that the Now Playing view accurately displays the current queue order (especially with shuffle enabled) and updates when playback state changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Navigate to Now Playing view
- [x] #2 Assert displayed track list matches queue.items order
- [x] #3 Enable shuffle and verify order updates
- [x] #4 Advance to next track and verify highlight moves
- [x] #5 Clear queue and verify empty state shown
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Test Location
Add to `app/frontend/tests/queue.spec.js` in describe block: `'Queue View Navigation @tauri'`

### Test Scenarios

```javascript
test('Now Playing view should display tracks in queue order', async ({ page }) => {
  // 1. Setup: Add tracks and start playback
  await page.waitForSelector('[data-track-id]', { state: 'visible' });
  await doubleClickTrackRow(page, 0);
  await waitForPlaying(page);
  
  // 2. Navigate to Now Playing view
  await page.evaluate(() => {
    window.Alpine.store('ui').view = 'nowPlaying';
  });
  
  // 3. Wait for queue items to render
  await page.waitForSelector('.queue-item', { state: 'visible', timeout: 5000 });
  
  // 4. Get queue order from store
  const storeOrder = await page.evaluate(() => 
    window.Alpine.store('queue').items.map(t => t.id)
  );
  
  // 5. Get displayed order from DOM
  const displayedOrder = await page.evaluate(() => {
    const items = document.querySelectorAll('.queue-item');
    return Array.from(items).map(el => el.dataset.trackId);
  });
  
  // 6. Assert: Order matches
  expect(displayedOrder).toEqual(storeOrder);
});

test('Now Playing view should update order when shuffle is toggled', async ({ page }) => {
  // 1. Setup
  await page.waitForSelector('[data-track-id]', { state: 'visible' });
  await doubleClickTrackRow(page, 0);
  await waitForPlaying(page);
  
  // 2. Navigate to Now Playing
  await page.evaluate(() => {
    window.Alpine.store('ui').view = 'nowPlaying';
  });
  await page.waitForSelector('.queue-item', { state: 'visible', timeout: 5000 });
  
  // 3. Record initial order
  const orderBefore = await page.evaluate(() => 
    window.Alpine.store('queue').items.map(t => t.id).join(',')
  );
  
  // 4. Toggle shuffle ON
  await page.locator('[data-testid="player-shuffle"]').click();
  await page.waitForTimeout(300);
  
  // 5. Get displayed order after shuffle
  const displayedAfterShuffle = await page.evaluate(() => {
    const items = document.querySelectorAll('.queue-item');
    return Array.from(items).map(el => el.dataset.trackId).join(',');
  });
  
  // 6. Verify: Store order matches display (they should both be shuffled)
  const storeAfterShuffle = await page.evaluate(() => 
    window.Alpine.store('queue').items.map(t => t.id).join(',')
  );
  expect(displayedAfterShuffle).toBe(storeAfterShuffle);
});

test('Now Playing view should highlight currently playing track', async ({ page }) => {
  // 1. Setup with multiple tracks
  await page.waitForSelector('[data-track-id]', { state: 'visible' });
  await doubleClickTrackRow(page, 0);
  await waitForPlaying(page);
  
  // 2. Skip to third track
  await page.locator('[data-testid="player-next"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="player-next"]').click();
  await page.waitForTimeout(200);
  
  // 3. Navigate to Now Playing
  await page.evaluate(() => {
    window.Alpine.store('ui').view = 'nowPlaying';
  });
  await page.waitForSelector('.queue-item', { state: 'visible', timeout: 5000 });
  
  // 4. Get current index from store
  const currentIndex = await page.evaluate(() => 
    window.Alpine.store('queue').currentIndex
  );
  
  // 5. Verify correct item has highlight
  const highlightedIndex = await page.evaluate(() => {
    const items = document.querySelectorAll('.queue-item');
    for (let i = 0; i < items.length; i++) {
      if (items[i].classList.contains('bg-primary') || 
          items[i].querySelector('.playing-indicator')) {
        return i;
      }
    }
    return -1;
  });
  
  expect(highlightedIndex).toBe(currentIndex);
});

test('Now Playing view should show empty state when queue cleared', async ({ page }) => {
  // Already tested in queue.spec.js line 372-388
  // Reference existing test: 'should show empty state when queue is empty'
});
```

### Key Selectors
- `window.Alpine.store('ui').view = 'nowPlaying'` - Navigate to Now Playing
- `.queue-item` - Individual track items in Now Playing view
- `.queue-item[data-track-id]` - Track ID on queue items
- `[data-testid="player-shuffle"]` - Shuffle toggle button

### DOM Structure (from index.html line 843+)
- Now Playing view is `<div x-show="$store.ui.view === 'nowPlaying'" x-data="nowPlayingView">`
- Queue items have class `.queue-item` with `data-track-id` attribute
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

Tests added at `app/frontend/tests/queue.spec.js:1159-1439` in a new `'Now Playing View (task-225)'` describe block.

### Test Approach

Tests use mock library data and run in browser-only mode (no Tauri backend required). They test the Now Playing view's display and interaction with queue state by directly manipulating Alpine stores.

### Test 1: `Now Playing view should display tracks in queue order`

**Validates:** AC #1, AC #2

Verifies that the displayed track list in Now Playing view matches `queue.playOrderItems` order (current track + upcoming tracks).

### Test 2: `Now Playing view should update order when shuffle is toggled`

**Validates:** AC #3

- Enables shuffle via store manipulation (`queue._shuffleItems()`)
- Verifies store order changed from original
- Verifies displayed order matches the new shuffled store order

### Test 3: `Now Playing view should highlight currently playing track`

**Validates:** AC #4 (partial)

- Sets queue to track at index 3
- Verifies first item in Now Playing view has highlight styling (`bg-primary/20`)
- Verifies highlighted track ID matches `player.currentTrack.id`

### Test 4: `Now Playing view should update highlight when track advances`

**Validates:** AC #4 (complete)

- Simulates track advance by incrementing `currentIndex` and updating `player.currentTrack`
- Verifies the first queue item is now the NEW current track (not the old one)

### Test 5: `Now Playing view should show empty state when queue is cleared`

**Validates:** AC #5

- Clears queue by setting `queue.items = []`
- Verifies empty state element is visible
- Verifies "Queue is empty" text is displayed in Now Playing view

### Run Command

Tests work in browser-only mode (no Tauri backend needed):

```bash
cd app/frontend
npx playwright test tests/queue.spec.js -g "task-225" --project=webkit
```

**Test verified:** All 5 tests pass (5/5 runs)
<!-- SECTION:NOTES:END -->
