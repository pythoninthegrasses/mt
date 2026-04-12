import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

/**
 * Type-to-jump artist navigation (task-255)
 *
 * When in library view, typing characters jumps to the first artist
 * matching the typed prefix. Ignore words (e.g., "The", "La") are
 * stripped before matching. Characters accumulate within a 500ms
 * debounce window.
 */
test.describe('Type-to-jump artist navigation (task-255)', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    // Ensure we're in library view
    await page.evaluate(() => {
      window.Alpine.store('ui').view = 'library';
    });
  });

  test('should jump to artist when typing characters', async ({ page }) => {
    // Type "p" to find Pink Floyd (first artist starting with 'p')
    await page.keyboard.type('p');

    // Wait for scroll and selection
    await page.waitForTimeout(100);

    // Check that a Pink Floyd track is selected
    const selectedTrackArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      const selectedTrack = tracks.find((t) => t.id === selectedIds[0]);
      return selectedTrack?.artist?.toLowerCase();
    });

    expect(selectedTrackArtist).toContain('pink floyd');
  });

  test('should be case-insensitive', async ({ page }) => {
    // Type "Q" in uppercase
    await page.keyboard.type('Q');

    await page.waitForTimeout(100);

    // Check that a Queen track is selected
    const selectedTrackArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      const selectedTrack = tracks.find((t) => t.id === selectedIds[0]);
      return selectedTrack?.artist?.toLowerCase();
    });

    expect(selectedTrackArtist).toBe('queen');
  });

  test('should match after stripping ignore words', async ({ page }) => {
    // Type "bea" which should match "The Beatles" after stripping "The "
    await page.keyboard.type('bea');

    await page.waitForTimeout(100);

    const selectedTrackArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      const selectedTrack = tracks.find((t) => t.id === selectedIds[0]);
      return selectedTrack?.artist?.toLowerCase();
    });

    expect(selectedTrackArtist).toContain('beatles');
  });

  test('should ignore article prefixes when sortIgnoreWords is enabled', async ({ page }) => {
    // Ensure sortIgnoreWords is enabled (default)
    await page.evaluate(() => {
      window.Alpine.store('ui').sortIgnoreWords = true;
      window.Alpine.store('ui').sortIgnoreWordsList = 'the, a, an, la, le, les, los, las, el';
    });

    // Type "dis" which should match "La Dispute" after stripping "La " prefix
    await page.keyboard.type('dis');

    await page.waitForTimeout(100);

    const selectedTrackArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      const selectedTrack = tracks.find((t) => t.id === selectedIds[0]);
      return selectedTrack?.artist?.toLowerCase();
    });

    expect(selectedTrackArtist).toContain('la dispute');
  });

  test('should match "Los" prefix artist when typing main word', async ({ page }) => {
    // Ensure sortIgnoreWords is enabled
    await page.evaluate(() => {
      window.Alpine.store('ui').sortIgnoreWords = true;
      window.Alpine.store('ui').sortIgnoreWordsList = 'the, a, an, la, le, les, los, las, el';
    });

    // Type "lob" which should match "Los Lobos" after stripping "Los " prefix
    await page.keyboard.type('lob');

    await page.waitForTimeout(100);

    const selectedTrackArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      const selectedTrack = tracks.find((t) => t.id === selectedIds[0]);
      return selectedTrack?.artist?.toLowerCase();
    });

    expect(selectedTrackArtist).toContain('los lobos');
  });

  test('should NOT ignore article prefixes when sortIgnoreWords is disabled', async ({ page }) => {
    // Disable sortIgnoreWords and invoke jumpToMatchingArtist directly
    // to avoid intermediate single-character matches from keystrokes
    const selectedArtist = await page.evaluate(() => {
      window.Alpine.store('ui').sortIgnoreWords = false;

      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      data.selectedTracks.clear();
      data.jumpToMatchingArtist('bea');

      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      const selectedTrack = tracks.find((t) => t.id === selectedIds[0]);
      return selectedTrack?.artist?.toLowerCase();
    });

    // "bea" should NOT match "The Beatles" when ignore words is disabled
    // because "the beatles" does not start with "bea" without stripping "The"
    expect(selectedArtist).toBeNull();
  });

  test('should accumulate characters within debounce window', async ({ page }) => {
    // Type "d", "a", "v" rapidly - should search "dav" for "David Bowie"
    await page.keyboard.type('d');
    await page.keyboard.type('a');
    await page.keyboard.type('v');

    await page.waitForTimeout(100);

    const selectedTrackArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      const selectedTrack = tracks.find((t) => t.id === selectedIds[0]);
      return selectedTrack?.artist?.toLowerCase();
    });

    expect(selectedTrackArtist).toContain('david bowie');
  });

  test('should clear buffer after debounce timeout', async ({ page }) => {
    // Type "d" (matches David Bowie)
    await page.keyboard.type('d');
    await page.waitForTimeout(100);

    // Wait for debounce timeout (600ms to be safe, buffer clears at 500ms)
    await page.waitForTimeout(600);

    // Type "q" - should search "q" not "dq", so should match Queen
    await page.keyboard.type('q');
    await page.waitForTimeout(100);

    const selectedTrackArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      const selectedTrack = tracks.find((t) => t.id === selectedIds[0]);
      return selectedTrack?.artist?.toLowerCase();
    });

    expect(selectedTrackArtist).toBe('queen');
  });

  test('should not trigger when typing in search input', async ({ page }) => {
    // First select a track by typing
    await page.keyboard.type('q');
    await page.waitForTimeout(100);

    // Clear selection
    await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      const data = window.Alpine.$data(browserEl);
      data.selectedTracks.clear();
    });

    // Focus the search input (if exists)
    const searchInput = page.locator('input[type="search"], input[placeholder*="earch"]').first();
    const hasSearch = await searchInput.count() > 0;

    if (hasSearch) {
      await searchInput.focus();
      await searchInput.type('test');

      // Selection should still be empty (typing in input should not trigger type-to-jump)
      const selectedCount = await page.evaluate(() => {
        const browserEl = document.querySelector('[x-data="libraryBrowser"]');
        const data = window.Alpine.$data(browserEl);
        return data.selectedTracks.size;
      });

      expect(selectedCount).toBe(0);
    }
  });

  test('should not trigger in Now Playing view', async ({ page }) => {
    // Switch to now playing view
    await page.evaluate(() => {
      window.Alpine.store('ui').view = 'nowPlaying';
    });
    await page.waitForTimeout(100);

    // Clear any selection first
    await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (browserEl) {
        const data = window.Alpine.$data(browserEl);
        data.selectedTracks.clear();
      }
    });

    // Type characters
    await page.keyboard.type('p');
    await page.waitForTimeout(100);

    // Selection should be empty (not in library view)
    const selectedCount = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return 0;
      const data = window.Alpine.$data(browserEl);
      return data.selectedTracks.size;
    });

    expect(selectedCount).toBe(0);
  });

  test('should select the matched track', async ({ page }) => {
    // Type to jump to an artist
    await page.keyboard.type('le'); // Should match "Led Zeppelin"
    await page.waitForTimeout(100);

    // Verify a track is selected
    const selectedCount = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return 0;
      const data = window.Alpine.$data(browserEl);
      return data.selectedTracks.size;
    });

    expect(selectedCount).toBe(1);

    // Verify it's a Led Zeppelin track
    const selectedTrackArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      const selectedTrack = tracks.find((t) => t.id === selectedIds[0]);
      return selectedTrack?.artist?.toLowerCase();
    });

    expect(selectedTrackArtist).toContain('led zeppelin');
  });

  test('should not trigger with modifier keys', async ({ page }) => {
    // Clear any existing selection
    await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (browserEl) {
        const data = window.Alpine.$data(browserEl);
        data.selectedTracks.clear();
      }
    });

    // Press Ctrl+P (should not trigger type-to-jump)
    await page.keyboard.press('Control+p');
    await page.waitForTimeout(100);

    // Selection should still be empty
    const selectedCount = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return 0;
      const data = window.Alpine.$data(browserEl);
      return data.selectedTracks.size;
    });

    expect(selectedCount).toBe(0);
  });

  test('should ignore non-printable keys', async ({ page }) => {
    // First make a selection with type-to-jump
    await page.keyboard.type('q');
    await page.waitForTimeout(100);

    // Get the buffer to verify 'q' was added
    const bufferBeforeArrow = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return '';
      const data = window.Alpine.$data(browserEl);
      return data._typeBuffer;
    });

    // Buffer should contain 'q'
    expect(bufferBeforeArrow).toBe('q');

    // Press arrow key (non-printable) - should not add to buffer
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);

    // Get the buffer to verify arrow key didn't add to it
    const bufferAfterArrow = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return '';
      const data = window.Alpine.$data(browserEl);
      return data._typeBuffer;
    });

    // Buffer should still be 'q' or empty (if debounce cleared it)
    // The key point is ArrowDown shouldn't be in the buffer
    expect(bufferAfterArrow).not.toContain('Arrow');
  });

  test('should use default ignore words when input is empty but feature enabled', async ({ page }) => {
    // Set up: enable ignore words but clear the list
    await page.evaluate(() => {
      window.Alpine.store('ui').sortIgnoreWords = true;
      window.Alpine.store('ui').sortIgnoreWordsList = ''; // Empty list
    });
    await page.waitForTimeout(100);

    // Clear any existing selection
    await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (browserEl) {
        const data = window.Alpine.$data(browserEl);
        data.selectedTracks.clear();
      }
    });

    // Type "la" - should match "The La's" because defaults include "the"
    await page.keyboard.type('la');
    await page.waitForTimeout(200);

    // Verify a track is selected
    const selectedArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      const selectedTrack = tracks.find((t) => t.id === selectedIds[0]);
      return selectedTrack?.artist?.toLowerCase();
    });

    // Should match an artist starting with "la" (after stripping default ignore words)
    expect(selectedArtist).toBeTruthy();
  });

  test('should prefer stripped-prefix match over raw name match', async ({ page }) => {
    // With ignore-word-aware sort order (as backend provides), "The La's"
    // (sorted as "La's") appears before "Lana Del Rey" in the track list.
    // jumpToMatchingArtist iterates in list order and matches "The La's" first
    // because stripped "la's" starts with "la".
    await page.evaluate(() => {
      const library = window.Alpine.store('library');
      // Insert in backend sort order: "La's" < "Lana Del Rey" alphabetically
      library.tracks.unshift(
        {
          id: 9999,
          title: 'There She Goes',
          artist: "The La's",
          album: "The La's",
          duration: 200,
          filepath: '/music/test/las.mp3',
        },
        {
          id: 9998,
          title: 'Decoy Track',
          artist: 'Lana Del Rey',
          album: 'Test Album',
          duration: 180,
          filepath: '/music/test/decoy.mp3',
        },
      );
      library.applyFilters();
      window.Alpine.store('ui').sortIgnoreWords = true;
      window.Alpine.store('ui').sortIgnoreWordsList = 'the, a, an, la, le, les, los, las, el';
    });
    await page.waitForTimeout(100);

    // Type "la"
    await page.keyboard.type('la');
    await page.waitForTimeout(200);

    const selectedArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      const selectedTrack = tracks.find((t) => t.id === selectedIds[0]);
      return selectedTrack?.artist;
    });

    // "The La's" (stripped prefix: "la's") matches first in sort order
    expect(selectedArtist).toBe("The La's");
  });

  test('should treat space as part of search query during active type-to-jump', async ({ page }) => {
    // Set player to playing - if space triggers togglePlay, it will pause
    await page.evaluate(() => {
      window.Alpine.store('player').isPlaying = true;
    });

    // Type "i" to start type-to-jump
    await page.keyboard.press('i');

    // Wait for Alpine to set typeToJumpActive before pressing space
    await page.waitForFunction(
      () => window.Alpine.store('ui').typeToJumpActive === true,
      { timeout: 2000 },
    );

    // Now press space - should NOT toggle play/pause
    await page.keyboard.press(' ');
    await page.waitForTimeout(100);

    // Player should STILL be playing (space was consumed by type-to-jump, not shortcuts)
    const isPlayingAfterSpace = await page.evaluate(() => {
      return window.Alpine.store('player').isPlaying;
    });
    expect(isPlayingAfterSpace).toBe(true);

    // Continue typing to match "I Break Horses"
    await page.keyboard.type('br');
    await page.waitForTimeout(200);

    const selectedArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      const selectedTrack = tracks.find((t) => t.id === selectedIds[0]);
      return selectedTrack?.artist;
    });

    expect(selectedArtist).toBe('I Break Horses');
  });

  test('space should still toggle play/pause when type-to-jump is not active', async ({ page }) => {
    // Set player to playing state so togglePlay will pause it
    await page.evaluate(() => {
      window.Alpine.store('player').isPlaying = true;
    });

    // Press space without any prior typing - should toggle play (pause it)
    await page.keyboard.press(' ');
    await page.waitForTimeout(100);

    const isPlaying = await page.evaluate(() => {
      return window.Alpine.store('player').isPlaying;
    });
    expect(isPlaying).toBe(false);
  });

  test('should cycle to next artist on repeated same-letter press', async ({ page }) => {
    // Press "e" to jump to first "E" artist
    await page.keyboard.press('e');
    await page.waitForTimeout(100);

    const firstArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      return tracks.find((t) => t.id === selectedIds[0])?.artist;
    });

    // Press "e" again to cycle to next "E" artist
    await page.keyboard.press('e');
    await page.waitForTimeout(100);

    const secondArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      return tracks.find((t) => t.id === selectedIds[0])?.artist;
    });

    // Both should be "E" artists but different ones
    expect(firstArtist).toBeTruthy();
    expect(secondArtist).toBeTruthy();
    expect(firstArtist.toLowerCase().startsWith('e')).toBe(true);
    expect(secondArtist.toLowerCase().startsWith('e')).toBe(true);
    expect(secondArtist).not.toBe(firstArtist);
  });

  test('should wrap around when cycling past last matching artist', async ({ page }) => {
    // Collect all distinct "E" artists
    const eArtists = await page.evaluate(() => {
      const tracks = window.Alpine.store('library').filteredTracks;
      const seen = new Set();
      return tracks
        .filter((t) => t.artist?.toLowerCase().startsWith('e'))
        .reduce((acc, t) => {
          if (!seen.has(t.artist)) {
            seen.add(t.artist);
            acc.push(t.artist);
          }
          return acc;
        }, []);
    });

    // Press "e" once for each distinct artist, then one more to wrap
    for (let i = 0; i <= eArtists.length; i++) {
      await page.keyboard.press('e');
      await page.waitForTimeout(100);
    }

    // After wrapping, should be back to first "E" artist
    const wrappedArtist = await page.evaluate(() => {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return null;
      const data = window.Alpine.$data(browserEl);
      const selectedIds = Array.from(data.selectedTracks);
      if (selectedIds.length === 0) return null;
      const tracks = window.Alpine.store('library').filteredTracks;
      return tracks.find((t) => t.id === selectedIds[0])?.artist;
    });

    expect(wrappedArtist).toBe(eArtists[0]);
  });
});
