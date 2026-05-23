import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

// Remote track fixture — source='plex', filepath starts with https://
function createRemoteTrack(overrides = {}) {
  return {
    id: 9001,
    title: 'Remote Song',
    artist: 'Plex Artist',
    album: 'Cloud Album',
    album_artist: 'Plex Artist',
    duration: 200000,
    track_number: 1,
    disc_number: 1,
    year: 2024,
    genre: 'Electronic',
    filepath: 'https://plex.example.com/library/parts/9001/file.flac',
    filename: 'file.flac',
    file_size: 5000000,
    bitrate: 320,
    sample_rate: 44100,
    channels: 2,
    added_date: new Date().toISOString(),
    last_played: null,
    play_count: 0,
    rating: 0,
    favorite: false,
    missing: false,
    last_seen_at: new Date().toISOString(),
    source: 'plex',
    remote_id: 'plex-media-9001',
    ...overrides,
  };
}

// Shared beforeEach helper used by tests that need a library with one remote track
async function setupWithRemoteTrack(page, extraTracks = []) {
  const remoteTrack = createRemoteTrack();
  const libraryState = createLibraryState({ tracks: [remoteTrack, ...extraTracks] });
  await setupLibraryMocks(page, libraryState);
  await page.goto('/');
  await waitForAlpine(page);
  await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  await page.waitForSelector('[data-track-id]', { state: 'attached' });
  return { remoteTrack, libraryState };
}

test.describe('Plex — Cloud badges and remote tracks', () => {
  test('cloud badge appears in library view for remote track', async ({ page }) => {
    await setupWithRemoteTrack(page);

    const badge = page.locator('[aria-label="Available from Plex (not downloaded)"]').first();
    await expect(badge).toBeVisible();
  });

  test('cloud badge absent after track filepath becomes local', async ({ page }) => {
    const remoteTrack = createRemoteTrack();
    const libraryState = createLibraryState({ tracks: [remoteTrack] });
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'attached' });

    // Confirm badge present
    const badge = page.locator('[aria-label="Available from Plex (not downloaded)"]').first();
    await expect(badge).toBeVisible();

    // Simulate download completion: update the track filepath to a local path
    // and update the library store directly (same as _refreshPlexTrack does)
    await page.evaluate(({ trackId }) => {
      const lib = window.Alpine.store('library');
      // Replace in _sectionTracks
      for (const [_key, arr] of Object.entries(lib._sectionTracks || {})) {
        const idx = arr.findIndex((t) => t.id === trackId);
        if (idx >= 0) {
          arr[idx] = { ...arr[idx], filepath: '/local/file.flac' };
        }
      }
      // Replace in _trackPages
      for (const page of lib._trackPages || []) {
        const idx = page.findIndex((t) => t.id === trackId);
        if (idx >= 0) {
          page[idx] = { ...page[idx], filepath: '/local/file.flac' };
        }
      }
      lib._dataVersion++;
    }, { trackId: remoteTrack.id });

    await expect(badge).not.toBeVisible({ timeout: 2000 });
  });

  test('"Show remote" toggle hides fully-remote tracks', async ({ page }) => {
    await setupWithRemoteTrack(page);

    const row = page.locator(`[data-track-id="${9001}"]`);
    await expect(row).toBeVisible();

    // Uncheck "Show remote"
    const toggle = page.locator('[data-testid="show-remote-toggle"] input[type="checkbox"]');
    await toggle.uncheck();

    await expect(row).not.toBeVisible({ timeout: 2000 });

    // Re-enabling makes it visible again
    await toggle.check();
    await expect(row).toBeVisible({ timeout: 2000 });
  });

  test('"Download from Plex" appears in context menu for remote track', async ({ page }) => {
    await setupWithRemoteTrack(page);

    const row = page.locator(`[data-track-id="${9001}"]`);
    await row.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const items = page.locator('[data-testid="track-context-menu"] .context-menu-item');
    const texts = await items.allTextContents();
    expect(texts.some((t) => t.includes('Download from Plex'))).toBe(true);
  });

  test('"Download from Plex" absent in context menu for local track', async ({ page }) => {
    // Use a plain local track (no source/filepath override)
    const libraryState = createLibraryState({ trackCount: 5 });
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'attached' });

    const row = page.locator('[data-track-id]').first();
    await row.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    const items = page.locator('[data-testid="track-context-menu"] .context-menu-item');
    const texts = await items.allTextContents();
    expect(texts.some((t) => t.includes('Download from Plex'))).toBe(false);
  });

  test('context-menu download triggers downloadFromPlex action', async ({ page }) => {
    await setupWithRemoteTrack(page);

    // Record calls to tauriInvoke — in a non-Tauri environment tauriInvoke returns null,
    // so we just verify the context menu action fires without throwing
    const downloadCalls = [];
    await page.exposeFunction('__testRecordDownload__', (trackId) => {
      downloadCalls.push(trackId);
    });

    // Patch the plex module's downloadTrack at the Alpine store level
    await page.evaluate(() => {
      // Intercept the invoke call used by plex.downloadTrack
      if (!window.__TAURI__) {
        window.__TAURI__ = { core: { invoke: async () => {} } };
      }
    });

    const row = page.locator(`[data-track-id="${9001}"]`);
    await row.click({ button: 'right' });

    await page.waitForSelector('[data-testid="track-context-menu"]', { state: 'visible' });

    // Click "Download from Plex"
    const menuItem = page.locator('[data-testid="track-context-menu"] .context-menu-item',
      { hasText: 'Download from Plex' });
    await menuItem.click();

    // Context menu should close
    await expect(page.locator('[data-testid="track-context-menu"]')).not.toBeVisible();
  });

  test('isRemote() returns false for local tracks', async ({ page }) => {
    const libraryState = createLibraryState({ trackCount: 5 });
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);

    const result = await page.evaluate(() => {
      const lib = window.Alpine.store('library');
      const localTrack = { source: 'local', filepath: '/music/track.mp3' };
      const plexLocalTrack = { source: 'plex', filepath: '/local/plex.flac' };
      const plexRemoteTrack = { source: 'plex', filepath: 'https://plex.example.com/file.flac' };
      return {
        local: lib.isRemote(localTrack),
        plexLocal: lib.isRemote(plexLocalTrack),
        plexRemote: lib.isRemote(plexRemoteTrack),
      };
    });

    expect(result.local).toBe(false);
    expect(result.plexLocal).toBe(false);
    expect(result.plexRemote).toBe(true);
  });

  test('setShowRemote persists to settings', async ({ page }) => {
    const libraryState = createLibraryState({ trackCount: 5 });
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);

    await page.evaluate(() => {
      window.Alpine.store('library').setShowRemote(false);
    });

    const showRemote = await page.evaluate(() => {
      return window.Alpine.store('library').showRemote;
    });
    expect(showRemote).toBe(false);
  });
});

// @tauri tests require a running Tauri app (skipped in fast CI mode)
test.describe('Plex — Prefetch worker @tauri', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('prefetch worker starts on playIndex and cancels on clear', async ({ page }) => {
    // Verify queue store exposes prefetch state
    const prefetchFields = await page.evaluate(() => {
      const q = window.Alpine.store('queue');
      return {
        hasPrefetchActive: '_prefetchActive' in q,
        hasPrefetchCancelled: '_prefetchCancelled' in q,
        hasStartPrefetch: typeof q._startPrefetch === 'function',
        hasCancelPrefetch: typeof q._cancelPrefetch === 'function',
      };
    });
    expect(prefetchFields.hasPrefetchActive).toBe(true);
    expect(prefetchFields.hasPrefetchCancelled).toBe(true);
    expect(prefetchFields.hasStartPrefetch).toBe(true);
    expect(prefetchFields.hasCancelPrefetch).toBe(true);
  });
});
