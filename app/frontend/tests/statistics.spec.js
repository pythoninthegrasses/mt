import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';
import { createPlaylistState, setupPlaylistMocks } from './fixtures/mock-playlists.js';

/**
 * Statistics Dashboard Tests
 *
 * Tests for the listening statistics section under Settings.
 * Uses mocked __TAURI__ invoke to simulate stats API responses.
 */

function setupStatsMocks(page) {
  return page.addInitScript(() => {
    window.__TAURI__ = {
      core: {
        invoke: async (cmd, args) => {
          // Track invoke calls for assertions
          window.__tauriInvokeCalls = window.__tauriInvokeCalls || [];
          window.__tauriInvokeCalls.push({ cmd, args });

          if (cmd === 'stats_get_overview') {
            return {
              total_plays: 1234,
              total_tracks_played: 89,
              total_artists_played: 42,
              total_listening_time: 345600,
            };
          }
          if (cmd === 'stats_get_top_artists') {
            return [
              { artist: 'Radiohead', play_count: 150, track_id: 1 },
              { artist: 'Pink Floyd', play_count: 120, track_id: 2 },
              { artist: 'Tool', play_count: 95, track_id: 3 },
            ];
          }
          if (cmd === 'stats_get_genres') {
            return [
              { genre: 'Rock', play_count: 500, track_count: 45 },
              { genre: 'Electronic', play_count: 300, track_count: 30 },
              { genre: 'Jazz', play_count: 100, track_count: 15 },
            ];
          }
          if (cmd === 'stats_get_plays_over_time') {
            return [
              { label: '2023', count: 400 },
              { label: '2024', count: 600 },
              { label: '2025', count: 234 },
            ];
          }
          if (cmd === 'stats_generate_chart_grid') {
            // Return a tiny 1x1 transparent PNG as data URL
            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAABNJREFUCB1jYGBg+A8EBwIA/wD/sQn+xQAAAABJRU5ErkJggg==';
          }
          if (cmd === 'library_get_artwork_url') {
            return null;
          }
          if (cmd === 'app_get_info') {
            return { version: '1.0.0', build: 'test', platform: 'test' };
          }
          if (cmd === 'watched_folders_list') {
            return [];
          }
          if (cmd === 'lastfm_get_settings') {
            return {
              enabled: false,
              username: null,
              authenticated: false,
              scrobble_threshold: 90,
            };
          }
          if (cmd === 'lastfm_queue_status') {
            return { queued_scrobbles: 0 };
          }
          if (cmd === 'settings_get_all') {
            return {};
          }
          return null;
        },
      },
      dialog: {
        open: async () => null,
        save: async () => null,
        confirm: async () => false,
      },
      shell: {
        open: async () => {},
      },
      event: {
        listen: async () => () => {},
      },
    };
    window.__tauriInvokeCalls = [];
  });
}

async function navigateToStats(page) {
  await page.goto('/');
  await waitForAlpine(page);
  await page.click('[data-testid="sidebar-settings"]');
  await page.click('[data-testid="settings-nav-stats"]');
  await page.waitForSelector('[data-testid="settings-section-stats"]', { state: 'visible' });
  // Wait for stats to load
  await page.waitForTimeout(500);
}

test.describe('Statistics Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    const playlistState = createPlaylistState();
    await setupPlaylistMocks(page, playlistState);
    await setupStatsMocks(page);
  });

  test('stats nav item is visible in settings', async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
    await page.click('[data-testid="sidebar-settings"]');

    const statsNav = page.locator('[data-testid="settings-nav-stats"]');
    await expect(statsNav).toBeVisible();
    await expect(statsNav).toHaveText('Statistics');
  });

  test('overview cards render with data', async ({ page }) => {
    await navigateToStats(page);

    const cards = page.locator('[data-testid="stats-overview-cards"]');
    await expect(cards).toBeVisible();

    await expect(page.locator('[data-testid="stats-total-plays"]')).toHaveText('1234');
    await expect(page.locator('[data-testid="stats-artists-played"]')).toHaveText('42');
    await expect(page.locator('[data-testid="stats-listening-time"]')).toContainText('4d');
  });

  test('top artists list renders', async ({ page }) => {
    await navigateToStats(page);

    const artistsSection = page.locator('[data-testid="stats-top-artists"]');
    await expect(artistsSection).toBeVisible();

    // Check artists are listed in order
    const artistNames = artistsSection.locator('.text-sm.truncate');
    await expect(artistNames.nth(0)).toHaveText('Radiohead');
    await expect(artistNames.nth(1)).toHaveText('Pink Floyd');
    await expect(artistNames.nth(2)).toHaveText('Tool');
  });

  test('plays-over-time chart renders', async ({ page }) => {
    await navigateToStats(page);

    const playsSection = page.locator('[data-testid="stats-plays-over-time"]');
    await expect(playsSection).toBeVisible();

    // Check year labels
    const labels = playsSection.locator('.tabular-nums.w-20');
    await expect(labels).toHaveCount(3);
  });

  test('genre breakdown renders', async ({ page }) => {
    await navigateToStats(page);

    const genreSection = page.locator('[data-testid="stats-genre-breakdown"]');
    await expect(genreSection).toBeVisible();

    // Check genre names
    const genreNames = genreSection.locator('.text-sm.truncate');
    await expect(genreNames.nth(0)).toHaveText('Rock');
    await expect(genreNames.nth(1)).toHaveText('Electronic');
    await expect(genreNames.nth(2)).toHaveText('Jazz');
  });

  test('date range filter invokes with correct range', async ({ page }) => {
    await navigateToStats(page);

    // Change to Last 7 Days
    await page.locator('[data-testid="stats-date-range"]').selectOption('Last7Days');
    await page.waitForTimeout(500);

    // Verify the invoke was called with the correct range
    const calls = await page.evaluate(() => window.__tauriInvokeCalls);
    const overviewCalls = calls.filter((c) => c.cmd === 'stats_get_overview');
    const lastCall = overviewCalls[overviewCalls.length - 1];
    expect(lastCall.args.range).toBe('Last7Days');
  });

  test('chart generator controls are visible', async ({ page }) => {
    await navigateToStats(page);

    const gridSection = page.locator('[data-testid="stats-chart-grid"]');
    await expect(gridSection).toBeVisible();

    await expect(page.locator('[data-testid="stats-grid-rows"]')).toBeVisible();
    await expect(page.locator('[data-testid="stats-grid-columns"]')).toBeVisible();
    await expect(page.locator('[data-testid="stats-grid-cell-size"]')).toBeVisible();
    await expect(page.locator('[data-testid="stats-grid-padding"]')).toBeVisible();
    await expect(page.locator('[data-testid="stats-grid-sort"]')).toBeVisible();
    await expect(page.locator('[data-testid="stats-grid-generate"]')).toBeVisible();
  });

  test('chart generator produces preview image', async ({ page }) => {
    await navigateToStats(page);

    // Click Generate
    await page.click('[data-testid="stats-grid-generate"]');
    await page.waitForTimeout(500);

    // Preview image should appear
    const preview = page.locator('[data-testid="stats-grid-preview"]');
    await expect(preview).toBeVisible();

    // Export button should appear
    const exportBtn = page.locator('[data-testid="stats-grid-export"]');
    await expect(exportBtn).toBeVisible();
  });
});
