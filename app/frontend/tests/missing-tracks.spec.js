import { test, expect } from '@playwright/test';
import {
  waitForAlpine,
  getAlpineStore,
  setAlpineStoreProperty,
} from './fixtures/helpers.js';
import {
  createLibraryState,
  setupLibraryMocks,
} from './fixtures/mock-library.js';

test.describe('Missing Track Status Column', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should have status column as first column', async ({ page }) => {
    const headerCells = page.locator('[data-testid="library-header"] > div');
    const firstCell = headerCells.first();
    await expect(firstCell).toBeVisible();
  });

  test('should show info icon in status column for missing tracks', async ({ page }) => {
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      if (library.tracks.length > 0) {
        library.tracks[0].missing = true;
        library.filteredTracks[0].missing = true;
      }
    });

    await page.waitForTimeout(100);

    const firstTrackRow = page.locator('[data-track-id]').first();
    const missingIcon = firstTrackRow.locator('[data-testid="missing-track-icon"]');
    await expect(missingIcon).toBeVisible();
  });

  test('should not show info icon for present tracks', async ({ page }) => {
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      if (library.tracks.length > 0) {
        library.tracks[0].missing = false;
        library.filteredTracks[0].missing = false;
      }
    });

    await page.waitForTimeout(100);

    const firstTrackRow = page.locator('[data-track-id]').first();
    const missingIcon = firstTrackRow.locator('[data-testid="missing-track-icon"]');
    await expect(missingIcon).not.toBeVisible();
  });

  test('should apply italic/muted styling to missing track title', async ({ page }) => {
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      if (library.tracks.length > 0) {
        library.tracks[0].missing = true;
        library.filteredTracks[0].missing = true;
      }
    });

    await page.waitForTimeout(100);

    const firstTrackRow = page.locator('[data-track-id]').first();
    const titleSpan = firstTrackRow.locator('[data-column="title"] span.truncate');
    const classes = await titleSpan.getAttribute('class');
    expect(classes).toContain('italic');
  });
});

test.describe('Missing Track Popover', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should open popover when clicking info icon', async ({ page }) => {
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      if (library.tracks.length > 0) {
        library.tracks[0].missing = true;
        library.tracks[0].filepath = '/test/path/to/missing/file.mp3';
        library.filteredTracks[0].missing = true;
        library.filteredTracks[0].filepath = '/test/path/to/missing/file.mp3';
      }
    });

    await page.waitForTimeout(100);

    const firstTrackRow = page.locator('[data-track-id]').first();
    const missingIcon = firstTrackRow.locator('[data-testid="missing-track-icon"]');
    await missingIcon.click();

    const popover = page.locator('[data-testid="missing-track-popover"]');
    await expect(popover).toBeVisible({ timeout: 5000 });
  });

  test('should display filepath in popover', async ({ page }) => {
    const testPath = '/test/path/to/missing/audio.flac';

    await page.evaluate((path) => {
      const library = window.Alpine.store('library');
      if (library.tracks.length > 0) {
        library.tracks[0].missing = true;
        library.tracks[0].filepath = path;
        library.filteredTracks[0].missing = true;
        library.filteredTracks[0].filepath = path;
      }
    }, testPath);

    await page.waitForTimeout(100);

    const firstTrackRow = page.locator('[data-track-id]').first();
    const missingIcon = firstTrackRow.locator('[data-testid="missing-track-icon"]');
    await missingIcon.click();

    const popover = page.locator('[data-testid="missing-track-popover"]');
    await expect(popover).toBeVisible({ timeout: 5000 });
    await expect(popover).toContainText(testPath);
  });

  test('should display "File Not Found" message in popover', async ({ page }) => {
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      if (library.tracks.length > 0) {
        library.tracks[0].missing = true;
        library.tracks[0].filepath = '/test/path/file.mp3';
        library.filteredTracks[0].missing = true;
        library.filteredTracks[0].filepath = '/test/path/file.mp3';
      }
    });

    await page.waitForTimeout(100);

    const firstTrackRow = page.locator('[data-track-id]').first();
    const missingIcon = firstTrackRow.locator('[data-testid="missing-track-icon"]');
    await missingIcon.click();

    const popover = page.locator('[data-testid="missing-track-popover"]');
    await expect(popover).toBeVisible({ timeout: 5000 });
    await expect(popover).toContainText('File Not Found');
  });

  test('should have Locate and Ignore buttons', async ({ page }) => {
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      if (library.tracks.length > 0) {
        library.tracks[0].missing = true;
        library.tracks[0].filepath = '/test/path/file.mp3';
        library.filteredTracks[0].missing = true;
        library.filteredTracks[0].filepath = '/test/path/file.mp3';
      }
    });

    await page.waitForTimeout(100);

    const firstTrackRow = page.locator('[data-track-id]').first();
    const missingIcon = firstTrackRow.locator('[data-testid="missing-track-icon"]');
    await missingIcon.click();

    const locateBtn = page.locator('[data-testid="popover-locate-btn"]');
    const ignoreBtn = page.locator('[data-testid="popover-ignore-btn"]');
    
    await expect(locateBtn).toBeVisible();
    await expect(ignoreBtn).toBeVisible();
  });

  test('should close popover when clicking Ignore', async ({ page }) => {
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      if (library.tracks.length > 0) {
        library.tracks[0].missing = true;
        library.tracks[0].filepath = '/test/path/file.mp3';
        library.filteredTracks[0].missing = true;
        library.filteredTracks[0].filepath = '/test/path/file.mp3';
      }
    });

    await page.waitForTimeout(100);

    const firstTrackRow = page.locator('[data-track-id]').first();
    const missingIcon = firstTrackRow.locator('[data-testid="missing-track-icon"]');
    await missingIcon.click();

    const popover = page.locator('[data-testid="missing-track-popover"]');
    await expect(popover).toBeVisible({ timeout: 5000 });

    const ignoreBtn = page.locator('[data-testid="popover-ignore-btn"]');
    await ignoreBtn.click();

    await expect(popover).not.toBeVisible({ timeout: 5000 });
  });

  test('should close popover when pressing Escape', async ({ page }) => {
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      if (library.tracks.length > 0) {
        library.tracks[0].missing = true;
        library.tracks[0].filepath = '/test/path/file.mp3';
        library.filteredTracks[0].missing = true;
        library.filteredTracks[0].filepath = '/test/path/file.mp3';
      }
    });

    await page.waitForTimeout(100);

    const firstTrackRow = page.locator('[data-track-id]').first();
    const missingIcon = firstTrackRow.locator('[data-testid="missing-track-icon"]');
    await missingIcon.click();

    const popover = page.locator('[data-testid="missing-track-popover"]');
    await expect(popover).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');

    await expect(popover).not.toBeVisible({ timeout: 5000 });
  });

  test('should display last seen timestamp when available', async ({ page }) => {
    const lastSeenDate = new Date('2025-01-15T10:30:00Z');

    await page.evaluate((timestamp) => {
      const library = window.Alpine.store('library');
      if (library.tracks.length > 0) {
        library.tracks[0].missing = true;
        library.tracks[0].filepath = '/test/path/file.mp3';
        library.tracks[0].last_seen_at = timestamp;
        library.filteredTracks[0].missing = true;
        library.filteredTracks[0].filepath = '/test/path/file.mp3';
        library.filteredTracks[0].last_seen_at = timestamp;
      }
    }, lastSeenDate.toISOString());

    await page.waitForTimeout(100);

    const firstTrackRow = page.locator('[data-track-id]').first();
    const missingIcon = firstTrackRow.locator('[data-testid="missing-track-icon"]');
    await missingIcon.click();

    const popover = page.locator('[data-testid="missing-track-popover"]');
    await expect(popover).toBeVisible({ timeout: 5000 });
    await expect(popover).toContainText('Last seen');
  });
});

test.describe('Missing Track Modal', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should show modal when playing missing track', async ({ page }) => {
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      if (library.tracks.length > 0) {
        library.tracks[0].missing = true;
        library.tracks[0].filepath = '/test/path/to/missing/file.mp3';
        library.filteredTracks[0].missing = true;
        library.filteredTracks[0].filepath = '/test/path/to/missing/file.mp3';
      }
    });

    await page.waitForTimeout(100);

    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.dblclick();

    await page.waitForFunction(() => {
      const ui = window.Alpine.store('ui');
      return ui.missingTrackModal !== null;
    }, { timeout: 5000 });

    const modal = page.locator('[data-testid="missing-track-modal"]');
    await expect(modal).toBeVisible();
  });

  test('should display "File Not Found" message in modal', async ({ page }) => {
    await page.evaluate(async () => {
      const track = { id: 1, title: 'Test Track', filepath: '/test/path/to/file.mp3' };
      window.Alpine.store('ui').showMissingTrackModal(track);
      await window.Alpine.nextTick();
    });

    const modal = page.locator('[data-testid="missing-track-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const heading = page.locator('[data-testid="missing-track-modal"] h3');
    await expect(heading).toContainText('File Not Found');
  });

  test('should display filepath in modal', async ({ page }) => {
    const testPath = '/test/path/to/missing/audio.flac';
    
    await page.evaluate((path) => {
      const track = { id: 1, title: 'Test Track', filepath: path };
      window.Alpine.store('ui').showMissingTrackModal(track);
    }, testPath);

    await page.waitForFunction(() => {
      const ui = window.Alpine.store('ui');
      return ui.missingTrackModal !== null;
    }, { timeout: 5000 });

    const modal = page.locator('[data-testid="missing-track-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal).toContainText(testPath);
  });

  test('should close modal when clicking "Leave as-is" button', async ({ page }) => {
    await page.evaluate(() => {
      const track = { id: 1, title: 'Test Track', filepath: '/test/path/to/file.mp3' };
      window.Alpine.store('ui').showMissingTrackModal(track);
    });

    await page.waitForFunction(() => {
      const ui = window.Alpine.store('ui');
      return ui.missingTrackModal !== null;
    }, { timeout: 5000 });

    const modal = page.locator('[data-testid="missing-track-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const leaveAsIsButton = page.locator('[data-testid="missing-track-cancel"]');
    await leaveAsIsButton.click();

    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });

  test('should have "Locate file..." button visible', async ({ page }) => {
    await page.evaluate(() => {
      const track = { id: 1, title: 'Test Track', filepath: '/test/path/to/file.mp3' };
      window.Alpine.store('ui').showMissingTrackModal(track);
    });

    await page.waitForFunction(() => {
      const ui = window.Alpine.store('ui');
      return ui.missingTrackModal !== null;
    }, { timeout: 5000 });

    const modal = page.locator('[data-testid="missing-track-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const locateButton = page.locator('[data-testid="missing-track-locate"]');
    await expect(locateButton).toBeVisible();
  });

  test('should close modal when calling closeMissingTrackModal', async ({ page }) => {
    await page.evaluate(() => {
      const track = { id: 1, title: 'Test Track', filepath: '/test/path/to/file.mp3' };
      window.Alpine.store('ui').showMissingTrackModal(track);
    });

    await page.waitForFunction(() => {
      const ui = window.Alpine.store('ui');
      return ui.missingTrackModal !== null;
    }, { timeout: 5000 });

    const modal = page.locator('[data-testid="missing-track-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    await page.evaluate(() => {
      window.Alpine.store('ui').closeMissingTrackModal('cancelled');
    });

    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('Missing Track Playback Interception', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
  });

  test('should intercept playback of missing track and show modal', async ({ page }) => {
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      if (library.tracks.length > 0) {
        library.tracks[0].missing = true;
        library.tracks[0].filepath = '/nonexistent/path/song.mp3';
        library.filteredTracks[0].missing = true;
        library.filteredTracks[0].filepath = '/nonexistent/path/song.mp3';
      }
    });

    const trackId = await page.evaluate(() => {
      return window.Alpine.store('library').filteredTracks[0]?.id;
    });

    // Don't await playTrack - it waits for modal interaction
    await page.evaluate((id) => {
      const library = window.Alpine.store('library');
      const track = library.tracks.find((t) => t.id === id);
      if (track) {
        window.Alpine.store('player').playTrack(track);
      }
    }, trackId);

    // Wait for modal to appear
    await page.waitForFunction(() => {
      const ui = window.Alpine.store('ui');
      return ui.missingTrackModal !== null;
    }, { timeout: 5000 });

    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.missingTrackModal).not.toBeNull();
  });

  test('should not intercept playback of present track', async ({ page }) => {
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      if (library.tracks.length > 0) {
        library.tracks[0].missing = false;
        library.filteredTracks[0].missing = false;
      }
    });

    const uiStoreBefore = await getAlpineStore(page, 'ui');
    expect(uiStoreBefore.missingTrackModal).toBeNull();

    const firstTrack = page.locator('[data-track-id]').first();
    await firstTrack.dblclick();

    await page.waitForTimeout(200);

    const uiStoreAfter = await getAlpineStore(page, 'ui');
    expect(uiStoreAfter.missingTrackModal).toBeNull();
  });
});
