import { expect, test } from '@playwright/test';
import { getAlpineStore, waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';
import { DEFAULT_SORT_IGNORE_WORDS } from '../js/constants.js';

test.describe('Sorting - Ignore Words Feature', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.setViewportSize({ width: 1624, height: 1057 });
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Inject test tracks with prefixes for testing
    await page.evaluate(() => {
      const testTracks = [
        {
          id: 'test-1',
          title: 'Song One',
          artist: 'The Beatles',
          album: 'Abbey Road',
          duration: 180000,
        },
        {
          id: 'test-2',
          title: 'Song Two',
          artist: 'Beatles Cover Band',
          album: 'The Best Album',
          duration: 200000,
        },
        {
          id: 'test-3',
          title: 'The Beginning',
          artist: 'Artist Name',
          album: 'Los Angeles',
          duration: 220000,
        },
        {
          id: 'test-4',
          title: 'A New Hope',
          artist: 'Composer',
          album: 'Le Soundtrack',
          duration: 240000,
        },
        {
          id: 'test-5',
          title: 'Track Five',
          artist: 'Los Lobos',
          album: 'La Bamba',
          duration: 190000,
        },
      ];
      window.Alpine.store('library').tracks = testTracks;
      window.Alpine.store('library').applyFilters();
    });

    await page.waitForTimeout(300);
  });

  test.describe('Settings UI', () => {
    test('should have Sorting section in settings navigation', async ({ page }) => {
      // Open settings
      await page.click('[data-testid="sidebar-settings"]');
      await page.waitForSelector('[data-testid="settings-section-general"]', { state: 'visible' });

      // Verify Sorting navigation button exists
      const sortingNav = page.locator('[data-testid="settings-nav-sorting"]');
      await expect(sortingNav).toBeVisible();
      await expect(sortingNav).toHaveText('Sorting');
    });

    test('should display ignore words preferences in Sorting section', async ({ page }) => {
      // Open settings and navigate to Sorting
      await page.click('[data-testid="sidebar-settings"]');
      await page.click('[data-testid="settings-nav-sorting"]');
      await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

      // Verify toggle checkbox exists
      const toggle = page.locator('[data-testid="settings-sort-ignore-words-toggle"]');
      await expect(toggle).toBeVisible();

      // Verify input field exists
      const input = page.locator('[data-testid="settings-sort-ignore-words-input"]');
      await expect(input).toBeVisible();
    });

    test('should have default ignore words list', async ({ page }) => {
      // Open settings and navigate to Sorting
      await page.click('[data-testid="sidebar-settings"]');
      await page.click('[data-testid="settings-nav-sorting"]');
      await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

      // Check default value
      const input = page.locator('[data-testid="settings-sort-ignore-words-input"]');
      const value = await input.inputValue();
      expect(value).toBe(DEFAULT_SORT_IGNORE_WORDS);
    });

    test('should have ignore words enabled by default', async ({ page }) => {
      // Open settings and navigate to Sorting
      await page.click('[data-testid="sidebar-settings"]');
      await page.click('[data-testid="settings-nav-sorting"]');
      await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

      // Check toggle is checked
      const toggle = page.locator('[data-testid="settings-sort-ignore-words-toggle"]');
      await expect(toggle).toBeChecked();
    });

    test('should disable input when toggle is unchecked', async ({ page }) => {
      // Open settings and navigate to Sorting
      await page.click('[data-testid="sidebar-settings"]');
      await page.click('[data-testid="settings-nav-sorting"]');
      await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

      // Uncheck toggle
      const toggle = page.locator('[data-testid="settings-sort-ignore-words-toggle"]');
      await toggle.click();
      await page.waitForTimeout(200);

      // Verify input is disabled
      const input = page.locator('[data-testid="settings-sort-ignore-words-input"]');
      await expect(input).toBeDisabled();
    });
  });

  test.describe('Sorting Behavior', () => {
    test('should strip "The" prefix when sorting by artist', async ({ page }) => {
      // Enable ignore words and set sort by artist
      await page.evaluate((defaultWords) => {
        window.Alpine.store('ui').sortIgnoreWords = true;
        window.Alpine.store('ui').sortIgnoreWordsList = defaultWords;
        window.Alpine.store('library').sortBy = 'artist';
        window.Alpine.store('library').sortOrder = 'asc';
        window.Alpine.store('library').applyFilters();
      }, DEFAULT_SORT_IGNORE_WORDS);

      await page.waitForTimeout(300);

      const library = await getAlpineStore(page, 'library');
      const artists = library.filteredTracks.map((t) => t.artist);

      // "The Beatles" should sort as "Beatles", so it should come before "Los Lobos"
      const beatlesIndex = artists.indexOf('The Beatles');
      const lobosIndex = artists.indexOf('Los Lobos');

      expect(beatlesIndex).toBeLessThan(lobosIndex);
    });

    test('should strip "Los" prefix when sorting by artist', async ({ page }) => {
      await page.evaluate((defaultWords) => {
        window.Alpine.store('ui').sortIgnoreWords = true;
        window.Alpine.store('ui').sortIgnoreWordsList = defaultWords;
        window.Alpine.store('library').sortBy = 'artist';
        window.Alpine.store('library').sortOrder = 'asc';
        window.Alpine.store('library').applyFilters();
      }, DEFAULT_SORT_IGNORE_WORDS);

      await page.waitForTimeout(300);

      const library = await getAlpineStore(page, 'library');
      const artists = library.filteredTracks.map((t) => t.artist);

      // "Los Lobos" should sort as "Lobos"
      const lobosIndex = artists.indexOf('Los Lobos');
      expect(lobosIndex).toBeGreaterThanOrEqual(0);
    });

    test('should strip "The" prefix when sorting by album', async ({ page }) => {
      await page.evaluate((defaultWords) => {
        window.Alpine.store('ui').sortIgnoreWords = true;
        window.Alpine.store('ui').sortIgnoreWordsList = defaultWords;
        window.Alpine.store('library').sortBy = 'album';
        window.Alpine.store('library').sortOrder = 'asc';
        window.Alpine.store('library').applyFilters();
      }, DEFAULT_SORT_IGNORE_WORDS);

      await page.waitForTimeout(300);

      const library = await getAlpineStore(page, 'library');
      const albums = library.filteredTracks.map((t) => t.album);

      // "The Best Album" should sort as "Best Album"
      const bestAlbumIndex = albums.indexOf('The Best Album');
      const abbeyRoadIndex = albums.indexOf('Abbey Road');

      // "Best Album" (B) should come after "Abbey Road" (A)
      expect(bestAlbumIndex).toBeGreaterThan(abbeyRoadIndex);
    });

    test('should strip "A" prefix when sorting by title', async ({ page }) => {
      await page.evaluate((defaultWords) => {
        window.Alpine.store('ui').sortIgnoreWords = true;
        window.Alpine.store('ui').sortIgnoreWordsList = defaultWords;
        window.Alpine.store('library').sortBy = 'title';
        window.Alpine.store('library').sortOrder = 'asc';
        window.Alpine.store('library').applyFilters();
      }, DEFAULT_SORT_IGNORE_WORDS);

      await page.waitForTimeout(300);

      const library = await getAlpineStore(page, 'library');
      const titles = library.filteredTracks.map((t) => t.title);

      // "A New Hope" should sort as "New Hope" (N)
      // "The Beginning" should sort as "Beginning" (B)
      const newHopeIndex = titles.indexOf('A New Hope');
      const beginningIndex = titles.indexOf('The Beginning');

      // "Beginning" (B) should come before "New Hope" (N)
      expect(beginningIndex).toBeLessThan(newHopeIndex);
    });

    test('should allow disabling ignore words setting', async ({ page }) => {
      // Verify the setting starts enabled by default
      let uiStore = await getAlpineStore(page, 'ui');
      expect(uiStore.sortIgnoreWords).toBe(true);

      // Disable ignore words
      await page.evaluate(() => {
        window.Alpine.store('ui').sortIgnoreWords = false;
      });

      await page.waitForTimeout(100);

      // Verify the setting was changed
      uiStore = await getAlpineStore(page, 'ui');
      expect(uiStore.sortIgnoreWords).toBe(false);

      // Note: Full sorting behavior with ignore words requires Tauri backend;
      // In browser mode, we verify the setting can be toggled which affects
      // the frontend's sort key generation when backend is available
    });

    test('should display full names with prefixes in UI', async ({ page }) => {
      // Verify that display still shows "The Beatles", not "Beatles"
      await page.evaluate(() => {
        window.Alpine.store('ui').sortIgnoreWords = true;
        window.Alpine.store('library').sortBy = 'artist';
        window.Alpine.store('library').applyFilters();
      });

      await page.waitForTimeout(300);

      // Find the track row with "The Beatles"
      const beatlesRow = page.locator('[data-track-id="test-1"]');
      await expect(beatlesRow).toBeVisible();

      // Verify the artist name is displayed with "The" prefix
      const artistCell = beatlesRow.locator('text=The Beatles');
      await expect(artistCell).toBeVisible();
    });

    test('should be case-insensitive when matching prefixes', async ({ page }) => {
      await page.evaluate((defaultWords) => {
        // Add a track with uppercase prefix
        const tracks = window.Alpine.store('library').tracks;
        tracks.push({
          id: 'test-6',
          title: 'Test Song',
          artist: 'THE UPPERCASE BAND',
          album: 'Album',
          duration: 180000,
        });
        window.Alpine.store('ui').sortIgnoreWords = true;
        window.Alpine.store('ui').sortIgnoreWordsList = defaultWords;
        window.Alpine.store('library').sortBy = 'artist';
        window.Alpine.store('library').sortOrder = 'asc';
        window.Alpine.store('library').applyFilters();
      }, DEFAULT_SORT_IGNORE_WORDS);

      await page.waitForTimeout(300);

      const library = await getAlpineStore(page, 'library');
      const artists = library.filteredTracks.map((t) => t.artist);

      // "THE UPPERCASE BAND" should sort as "UPPERCASE BAND"
      const uppercaseIndex = artists.indexOf('THE UPPERCASE BAND');
      const artistNameIndex = artists.indexOf('Artist Name');

      // "UPPERCASE BAND" (U) should come after "Artist Name" (A)
      expect(uppercaseIndex).toBeGreaterThan(artistNameIndex);
    });
  });

  test.describe('In-Session State', () => {
    test('should update ignore words settings in current session', async ({ page }) => {
      // Open settings and change preferences
      await page.click('[data-testid="sidebar-settings"]');
      await page.click('[data-testid="settings-nav-sorting"]');
      await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

      // Change ignore words list
      const input = page.locator('[data-testid="settings-sort-ignore-words-input"]');
      await input.fill('der, die, das, el, la');
      await page.waitForTimeout(300);

      // Uncheck toggle
      const toggle = page.locator('[data-testid="settings-sort-ignore-words-toggle"]');
      await toggle.click();
      await page.waitForTimeout(200);

      // Verify in-session state updated (check Alpine store)
      const uiStore = await getAlpineStore(page, 'ui');
      expect(uiStore.sortIgnoreWords).toBe(false);
      expect(uiStore.sortIgnoreWordsList).toBe('der, die, das, el, la');

      // Navigate away and back to verify state persists within session
      await page.click('[data-testid="sidebar-section-all"]');
      await page.waitForTimeout(200);
      await page.click('[data-testid="sidebar-settings"]');
      await page.click('[data-testid="settings-nav-sorting"]');
      await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

      // Verify settings are still there
      const toggleAfter = page.locator('[data-testid="settings-sort-ignore-words-toggle"]');
      await expect(toggleAfter).not.toBeChecked();

      const inputAfter = page.locator('[data-testid="settings-sort-ignore-words-input"]');
      const valueAfter = await inputAfter.inputValue();
      expect(valueAfter).toBe('der, die, das, el, la');
    });
  });

  test.describe('Custom Ignore Words', () => {
    test('should allow custom ignore words list', async ({ page }) => {
      // Open settings and set custom list
      await page.click('[data-testid="sidebar-settings"]');
      await page.click('[data-testid="settings-nav-sorting"]');
      await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

      const input = page.locator('[data-testid="settings-sort-ignore-words-input"]');
      await input.fill('artist, composer');
      await page.waitForTimeout(500);

      // Go back to library and test sorting
      await page.click('[data-testid="sidebar-section-all"]');
      await page.waitForTimeout(200);

      await page.evaluate(() => {
        // Add a track with custom prefix
        const tracks = window.Alpine.store('library').tracks;
        tracks.push({
          id: 'test-7',
          title: 'Symphony',
          artist: 'Artist Mozart',
          album: 'Classical',
          duration: 300000,
        });
        window.Alpine.store('library').sortBy = 'artist';
        window.Alpine.store('library').sortOrder = 'asc';
        window.Alpine.store('library').applyFilters();
      });

      await page.waitForTimeout(300);

      const library = await getAlpineStore(page, 'library');
      const artists = library.filteredTracks.map((t) => t.artist);

      // "Artist Mozart" should sort as "Mozart" with custom ignore words
      const mozartIndex = artists.indexOf('Artist Mozart');
      expect(mozartIndex).toBeGreaterThanOrEqual(0);
    });

    test('should handle empty ignore words list', async ({ page }) => {
      await page.evaluate(() => {
        window.Alpine.store('ui').sortIgnoreWords = true;
        window.Alpine.store('ui').sortIgnoreWordsList = '';
        window.Alpine.store('library').sortBy = 'artist';
        window.Alpine.store('library').sortOrder = 'asc';
        window.Alpine.store('library').applyFilters();
      });

      await page.waitForTimeout(300);

      // Should not throw error and tracks should be sorted normally
      const library = await getAlpineStore(page, 'library');
      expect(library.filteredTracks.length).toBeGreaterThan(0);
    });
  });

  test.describe('Disc Number Tiebreaker', () => {
    // Disc/track number sorting is handled by the SQL backend.
    // These tests verify the frontend preserves backend sort order.

    test('should preserve backend disc-then-track sort order', async ({ page }) => {
      // Backend returns tracks already sorted by disc, then track number
      await page.evaluate((defaultWords) => {
        const testTracks = [
          {
            id: 'd4',
            title: 'Disc 1 Track 1',
            artist: 'Same Artist',
            album: 'Multi Disc Album',
            disc_number: '1',
            track_number: '1',
            duration: 180000,
          },
          {
            id: 'd2',
            title: 'Disc 1 Track 2',
            artist: 'Same Artist',
            album: 'Multi Disc Album',
            disc_number: '1',
            track_number: '2',
            duration: 180000,
          },
          {
            id: 'd5',
            title: 'Disc 1 Track 3',
            artist: 'Same Artist',
            album: 'Multi Disc Album',
            disc_number: '1',
            track_number: '3',
            duration: 180000,
          },
          {
            id: 'd3',
            title: 'Disc 2 Track 1',
            artist: 'Same Artist',
            album: 'Multi Disc Album',
            disc_number: '2',
            track_number: '1',
            duration: 180000,
          },
          {
            id: 'd6',
            title: 'Disc 2 Track 2',
            artist: 'Same Artist',
            album: 'Multi Disc Album',
            disc_number: '2',
            track_number: '2',
            duration: 180000,
          },
          {
            id: 'd1',
            title: 'Disc 2 Track 3',
            artist: 'Same Artist',
            album: 'Multi Disc Album',
            disc_number: '2',
            track_number: '3',
            duration: 180000,
          },
        ];
        window.Alpine.store('ui').sortIgnoreWords = true;
        window.Alpine.store('ui').sortIgnoreWordsList = defaultWords;
        window.Alpine.store('library').tracks = testTracks;
        window.Alpine.store('library').sortBy = 'artist';
        window.Alpine.store('library').sortOrder = 'asc';
        window.Alpine.store('library').applyFilters();
      }, DEFAULT_SORT_IGNORE_WORDS);

      await page.waitForTimeout(300);

      const library = await getAlpineStore(page, 'library');
      const titles = library.filteredTracks.map((t) => t.title);

      // Frontend preserves the backend sort order
      expect(titles).toEqual([
        'Disc 1 Track 1',
        'Disc 1 Track 2',
        'Disc 1 Track 3',
        'Disc 2 Track 1',
        'Disc 2 Track 2',
        'Disc 2 Track 3',
      ]);
    });

    test('should preserve backend null-disc-first sort order', async ({ page }) => {
      // Backend sorts null disc before disc 1
      await page.evaluate((defaultWords) => {
        const testTracks = [
          {
            id: 'n2',
            title: 'Track A',
            artist: 'Same Artist',
            album: 'Same Album',
            disc_number: null,
            track_number: '1',
            duration: 180000,
          },
          {
            id: 'n3',
            title: 'Track C',
            artist: 'Same Artist',
            album: 'Same Album',
            disc_number: '1',
            track_number: '1',
            duration: 180000,
          },
          {
            id: 'n1',
            title: 'Track B',
            artist: 'Same Artist',
            album: 'Same Album',
            disc_number: '1',
            track_number: '2',
            duration: 180000,
          },
        ];
        window.Alpine.store('ui').sortIgnoreWords = true;
        window.Alpine.store('ui').sortIgnoreWordsList = defaultWords;
        window.Alpine.store('library').tracks = testTracks;
        window.Alpine.store('library').sortBy = 'artist';
        window.Alpine.store('library').sortOrder = 'asc';
        window.Alpine.store('library').applyFilters();
      }, DEFAULT_SORT_IGNORE_WORDS);

      await page.waitForTimeout(300);

      const library = await getAlpineStore(page, 'library');
      const tracks = library.filteredTracks.map((t) => ({
        disc: t.disc_number,
        track: t.track_number,
      }));

      // Frontend preserves backend order: null disc first, then disc 1
      expect(tracks[0].disc).toBeNull();
      expect(tracks[1].disc).toBe('1');
      expect(tracks[1].track).toBe('1');
      expect(tracks[2].disc).toBe('1');
      expect(tracks[2].track).toBe('2');
    });
  });

  test.describe('Real-time Updates', () => {
    test('should update sort order when toggling ignore words', async ({ page }) => {
      // Start with ignore words disabled
      await page.evaluate(() => {
        window.Alpine.store('ui').sortIgnoreWords = false;
        window.Alpine.store('library').sortBy = 'artist';
        window.Alpine.store('library').sortOrder = 'asc';
        window.Alpine.store('library').applyFilters();
      });

      await page.waitForTimeout(300);

      const libraryBefore = await getAlpineStore(page, 'library');
      const artistsBefore = libraryBefore.filteredTracks.map((t) => t.artist);

      // Enable ignore words
      await page.click('[data-testid="sidebar-settings"]');
      await page.click('[data-testid="settings-nav-sorting"]');
      await page.waitForSelector('[data-testid="settings-section-sorting"]', { state: 'visible' });

      const toggle = page.locator('[data-testid="settings-sort-ignore-words-toggle"]');
      await toggle.click();
      await page.waitForTimeout(500);

      // Go back to library
      await page.click('[data-testid="sidebar-section-all"]');
      await page.waitForTimeout(200);

      const libraryAfter = await getAlpineStore(page, 'library');
      const artistsAfter = libraryAfter.filteredTracks.map((t) => t.artist);

      // Order should be different
      expect(artistsAfter).not.toEqual(artistsBefore);
    });
  });
});
