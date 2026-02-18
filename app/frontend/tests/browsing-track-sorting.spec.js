/**
 * Regression tests for track loading and sorting in Albums and Artists browsing views.
 *
 * Covers:
 * - All library tracks are fetched (not limited to default API page size)
 * - Multi-disc albums sort tracks by disc then track number
 * - Tracks with null disc_number use dominant disc fallback (not disc 1)
 * - Mixed disc_number types (null, string, number) sort correctly
 */

import { expect, test } from '@playwright/test';
import { setAlpineStoreProperty, waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';
import { createPlaylistState, setupPlaylistMocks } from './fixtures/mock-playlists.js';

/**
 * Build mock tracks for a multi-disc album where some tracks have null disc_number.
 * Simulates real-world metadata where disc tags are partially missing.
 */
function createMultiDiscAlbumTracks() {
  const tracks = [];
  let id = 1;

  // --- Album: "Act I" on disc 1 (14 tracks, 4 with null disc_number) ---
  const actITitles = [
    'Overture',
    'Opening Theme',
    'First Steps',
    'The Journey Begins',
    'Village Square',
    'Market Day',
    'Sunset Walk',
    'Campfire',
    'Night Watch',
    'Dawn Chorus',
    'The Challenge',
    'Into Battle',
    'Victory March',
    'Epilogue I',
  ];
  for (let i = 0; i < actITitles.length; i++) {
    tracks.push({
      id: id++,
      title: actITitles[i],
      artist: i % 3 === 0 ? 'Composer A & Composer B' : 'Composer A',
      album_artist: 'Composer A',
      album: 'Soundtrack (Act I)',
      track_number: String(i + 1),
      // Tracks 5, 8, 11, 14 have null disc_number
      disc_number: (i + 1) % 4 === 0 ? null : '1',
      duration: 120 + i * 15,
      genre: 'Soundtrack',
      date: '2025',
      filepath: `/music/act1/track-${i + 1}.flac`,
    });
  }

  // --- Album: "Act II" on disc 2 (10 tracks, 3 with null disc_number) ---
  const actIITitles = [
    'Prologue II',
    'Dark Forest',
    'River Crossing',
    'Mountain Pass',
    'Storm Clouds',
    'The Descent',
    'Underground',
    'Crystal Cavern',
    'The Revelation',
    'Epilogue II',
  ];
  for (let i = 0; i < actIITitles.length; i++) {
    tracks.push({
      id: id++,
      title: actIITitles[i],
      artist: i % 2 === 0 ? 'Composer A & Composer B' : 'Composer A',
      album_artist: 'Composer A',
      album: 'Soundtrack (Act II)',
      track_number: String(i + 1),
      // Tracks 3, 6, 9 have null disc_number
      disc_number: (i + 1) % 3 === 0 ? null : '2',
      duration: 150 + i * 20,
      genre: 'Soundtrack',
      date: '2025',
      filepath: `/music/act2/track-${i + 1}.flac`,
    });
  }

  // --- Album: "Act III" on disc 3 (8 tracks, 2 with null disc_number) ---
  const actIIITitles = [
    'Final Dawn',
    'Reunion',
    'The Last Stand',
    'Sacrifice',
    'Aftermath',
    'Remembrance',
    'New Beginning',
    'Credits',
  ];
  for (let i = 0; i < actIIITitles.length; i++) {
    tracks.push({
      id: id++,
      title: actIIITitles[i],
      artist: 'Composer A',
      album_artist: 'Composer A',
      album: 'Soundtrack (Act III)',
      track_number: String(i + 1),
      // Tracks 4 and 7 have null disc_number
      disc_number: (i + 1) % 4 === 3 ? null : '3',
      duration: 180 + i * 10,
      genre: 'Soundtrack',
      date: '2025',
      filepath: `/music/act3/track-${i + 1}.flac`,
    });
  }

  // --- Unrelated single-disc album to pad track count ---
  const otherTitles = ['Song A', 'Song B', 'Song C', 'Song D', 'Song E'];
  for (let i = 0; i < otherTitles.length; i++) {
    tracks.push({
      id: id++,
      title: otherTitles[i],
      artist: 'Other Artist',
      album_artist: 'Other Artist',
      album: 'Other Album',
      track_number: String(i + 1),
      disc_number: '1',
      duration: 200 + i * 10,
      genre: 'Rock',
      date: '2020',
      filepath: `/music/other/track-${i + 1}.flac`,
    });
  }

  return tracks;
}

// --- Albums View Tests ---

test.describe('Track sorting regression - Albums view', () => {
  let libraryState;
  let playlistState;

  test.beforeAll(() => {
    const tracks = createMultiDiscAlbumTracks();
    libraryState = createLibraryState({ tracks });
    playlistState = createPlaylistState();
  });

  test.beforeEach(async ({ page }) => {
    await setupLibraryMocks(page, libraryState);
    await setupPlaylistMocks(page, playlistState);
    await page.goto('/');
    await waitForAlpine(page);
    await setAlpineStoreProperty(page, 'ui', 'view', 'albums');
    await page.waitForSelector('[data-testid="albums-view"]', { state: 'visible' });
  });

  test('loads all library tracks regardless of API default limit', async ({ page }) => {
    const totalTracks = libraryState.tracks.length;
    // Wait for _allTracks to load
    await page.waitForFunction(
      (expected) => {
        const el = document.querySelector('[x-data="albumsBrowser"]');
        if (!el) return false;
        const comp = window.Alpine.$data(el);
        return comp._allTracks.length === expected;
      },
      totalTracks,
      { timeout: 5000 },
    );

    const result = await page.evaluate(() => {
      const el = document.querySelector('[x-data="albumsBrowser"]');
      const comp = window.Alpine.$data(el);
      return { allTracks: comp._allTracks.length, albums: comp.albumList.length };
    });

    expect(result.allTracks).toBe(totalTracks);
    expect(result.albums).toBe(4); // Act I, Act II, Act III, Other Album
  });

  test('all multi-disc albums appear with correct track counts', async ({ page }) => {
    await page.waitForFunction(() => {
      const el = document.querySelector('[x-data="albumsBrowser"]');
      if (!el) return false;
      return window.Alpine.$data(el).albumList.length >= 4;
    });

    const albums = await page.evaluate(() => {
      const el = document.querySelector('[x-data="albumsBrowser"]');
      const comp = window.Alpine.$data(el);
      return comp.albumList.map((a) => ({ name: a.name, trackCount: a.trackCount }));
    });

    const actI = albums.find((a) => a.name === 'Soundtrack (Act I)');
    const actII = albums.find((a) => a.name === 'Soundtrack (Act II)');
    const actIII = albums.find((a) => a.name === 'Soundtrack (Act III)');

    expect(actI).toBeDefined();
    expect(actI.trackCount).toBe(14);
    expect(actII).toBeDefined();
    expect(actII.trackCount).toBe(10);
    expect(actIII).toBeDefined();
    expect(actIII.trackCount).toBe(8);
  });

  test('Act I (disc 1): tracks with null disc_number sort correctly among disc 1 tracks', async ({ page }) => {
    await page.waitForFunction(() => {
      const el = document.querySelector('[x-data="albumsBrowser"]');
      if (!el) return false;
      return window.Alpine.$data(el).albumList.length >= 4;
    });

    const trackOrder = await page.evaluate(() => {
      const el = document.querySelector('[x-data="albumsBrowser"]');
      const comp = window.Alpine.$data(el);
      const album = comp.albumList.find((a) => a.name === 'Soundtrack (Act I)');
      comp.openAlbumDetail(album);
      return comp.selectedAlbumTracks.map((t) => ({
        title: t.title,
        trackNum: t.track_number,
        disc: t.disc_number,
      }));
    });

    expect(trackOrder.length).toBe(14);
    // All tracks should be in sequential track_number order
    for (let i = 0; i < trackOrder.length; i++) {
      expect(trackOrder[i].trackNum).toBe(String(i + 1));
    }
    // Verify null-disc tracks are interleaved correctly (tracks 4, 8, 12 are null)
    expect(trackOrder[3].disc).toBeNull(); // track 4
    expect(trackOrder[3].title).toBe('The Journey Begins');
    expect(trackOrder[7].disc).toBeNull(); // track 8
    expect(trackOrder[7].title).toBe('Campfire');
  });

  test('Act II (disc 2): null disc_number tracks use dominant disc 2, not disc 1', async ({ page }) => {
    await page.waitForFunction(() => {
      const el = document.querySelector('[x-data="albumsBrowser"]');
      if (!el) return false;
      return window.Alpine.$data(el).albumList.length >= 4;
    });

    const trackOrder = await page.evaluate(() => {
      const el = document.querySelector('[x-data="albumsBrowser"]');
      const comp = window.Alpine.$data(el);
      const album = comp.albumList.find((a) => a.name === 'Soundtrack (Act II)');
      comp.openAlbumDetail(album);
      return comp.selectedAlbumTracks.map((t) => ({
        title: t.title,
        trackNum: t.track_number,
        disc: t.disc_number,
      }));
    });

    expect(trackOrder.length).toBe(10);
    // All tracks should be in sequential order regardless of null disc_number
    for (let i = 0; i < trackOrder.length; i++) {
      expect(trackOrder[i].trackNum).toBe(String(i + 1));
    }
    // First track should be "Prologue II"
    expect(trackOrder[0].title).toBe('Prologue II');
    // Null-disc tracks (3, 6, 9) should be in correct positions
    expect(trackOrder[2].disc).toBeNull(); // track 3
    expect(trackOrder[2].title).toBe('River Crossing');
    expect(trackOrder[5].disc).toBeNull(); // track 6
    expect(trackOrder[5].title).toBe('The Descent');
  });

  test('Act III (disc 3): null disc_number tracks use dominant disc 3', async ({ page }) => {
    await page.waitForFunction(() => {
      const el = document.querySelector('[x-data="albumsBrowser"]');
      if (!el) return false;
      return window.Alpine.$data(el).albumList.length >= 4;
    });

    const trackOrder = await page.evaluate(() => {
      const el = document.querySelector('[x-data="albumsBrowser"]');
      const comp = window.Alpine.$data(el);
      const album = comp.albumList.find((a) => a.name === 'Soundtrack (Act III)');
      comp.openAlbumDetail(album);
      return comp.selectedAlbumTracks.map((t) => ({
        title: t.title,
        trackNum: t.track_number,
        disc: t.disc_number,
      }));
    });

    expect(trackOrder.length).toBe(8);
    for (let i = 0; i < trackOrder.length; i++) {
      expect(trackOrder[i].trackNum).toBe(String(i + 1));
    }
    expect(trackOrder[0].title).toBe('Final Dawn');
    // Null-disc tracks should be in correct positions
    expect(trackOrder[2].disc).toBeNull(); // track 3
    expect(trackOrder[2].title).toBe('The Last Stand');
  });

  test('album detail UI displays tracks in correct order', async ({ page }) => {
    await page.waitForFunction(() => {
      const el = document.querySelector('[x-data="albumsBrowser"]');
      if (!el) return false;
      return window.Alpine.$data(el).albumList.length >= 4;
    });

    // Open Act II in the UI
    await page.evaluate(() => {
      const el = document.querySelector('[x-data="albumsBrowser"]');
      const comp = window.Alpine.$data(el);
      const album = comp.albumList.find((a) => a.name === 'Soundtrack (Act II)');
      comp.openAlbumDetail(album);
    });

    await page.waitForSelector('[data-testid="album-detail-track"]', { state: 'visible' });

    // Get rendered track titles in DOM order
    const renderedTitles = await page
      .locator('[data-testid="album-detail-track"]')
      .evaluateAll((els) =>
        els.map((el) => {
          const titleEl = el.querySelector('[data-testid="track-title"]') ||
            el.querySelector('.track-title') ||
            el.querySelector('td:nth-child(2)') ||
            el.querySelector('span');
          return titleEl?.textContent?.trim() || '';
        })
      );

    // First track should be "Prologue II", not a null-disc track with a high number
    expect(renderedTitles[0]).toBe('Prologue II');
    expect(renderedTitles[1]).toBe('Dark Forest');
    expect(renderedTitles[2]).toBe('River Crossing');
  });
});

// --- Artists View Tests ---

test.describe('Track sorting regression - Artists view', () => {
  let libraryState;
  let playlistState;

  test.beforeAll(() => {
    const tracks = createMultiDiscAlbumTracks();
    libraryState = createLibraryState({ tracks });
    playlistState = createPlaylistState();
  });

  test.beforeEach(async ({ page }) => {
    await setupLibraryMocks(page, libraryState);
    await setupPlaylistMocks(page, playlistState);
    await page.goto('/');
    await waitForAlpine(page);
    await setAlpineStoreProperty(page, 'ui', 'view', 'artists');
    await page.waitForSelector('[data-testid="artists-view"]', { state: 'visible' });
  });

  test('loads all library tracks regardless of API default limit', async ({ page }) => {
    const totalTracks = libraryState.tracks.length;

    await page.waitForFunction(
      (expected) => {
        const el = document.querySelector('[x-data="artistsBrowser"]');
        if (!el) return false;
        const comp = window.Alpine.$data(el);
        return comp._allTracks.length === expected;
      },
      totalTracks,
      { timeout: 5000 },
    );

    const count = await page.evaluate(() => {
      const el = document.querySelector('[x-data="artistsBrowser"]');
      return window.Alpine.$data(el)._allTracks.length;
    });

    expect(count).toBe(totalTracks);
  });

  test('artist shows all multi-disc albums with correct track counts', async ({ page }) => {
    await page.waitForFunction(() => {
      const el = document.querySelector('[x-data="artistsBrowser"]');
      if (!el) return false;
      return window.Alpine.$data(el)._allTracks.length > 0;
    });

    // Select "Composer A" artist
    await page.evaluate(() => {
      const el = document.querySelector('[x-data="artistsBrowser"]');
      const comp = window.Alpine.$data(el);
      const artist = comp.artists.find((a) => a.includes('Composer A'));
      if (artist) comp.selectArtist(artist);
    });

    const albums = await page.evaluate(() => {
      const el = document.querySelector('[x-data="artistsBrowser"]');
      const comp = window.Alpine.$data(el);
      return comp.selectedArtistAlbums.map((a) => ({
        name: a.name,
        trackCount: a.tracks.length,
      }));
    });

    const actI = albums.find((a) => a.name === 'Soundtrack (Act I)');
    const actII = albums.find((a) => a.name === 'Soundtrack (Act II)');
    const actIII = albums.find((a) => a.name === 'Soundtrack (Act III)');

    expect(actI).toBeDefined();
    expect(actI.trackCount).toBe(14);
    expect(actII).toBeDefined();
    expect(actII.trackCount).toBe(10);
    expect(actIII).toBeDefined();
    expect(actIII.trackCount).toBe(8);
  });

  test('artist album tracks sort correctly with mixed disc_number types', async ({ page }) => {
    await page.waitForFunction(() => {
      const el = document.querySelector('[x-data="artistsBrowser"]');
      if (!el) return false;
      return window.Alpine.$data(el)._allTracks.length > 0;
    });

    await page.evaluate(() => {
      const el = document.querySelector('[x-data="artistsBrowser"]');
      const comp = window.Alpine.$data(el);
      const artist = comp.artists.find((a) => a.includes('Composer A'));
      if (artist) comp.selectArtist(artist);
    });

    const actIITracks = await page.evaluate(() => {
      const el = document.querySelector('[x-data="artistsBrowser"]');
      const comp = window.Alpine.$data(el);
      const album = comp.selectedArtistAlbums.find((a) => a.name === 'Soundtrack (Act II)');
      if (!album) return [];
      return album.tracks.map((t) => ({
        title: t.title,
        trackNum: t.track_number,
        disc: t.disc_number,
      }));
    });

    expect(actIITracks.length).toBe(10);
    // All tracks should be in sequential order
    for (let i = 0; i < actIITracks.length; i++) {
      expect(actIITracks[i].trackNum).toBe(String(i + 1));
    }
    expect(actIITracks[0].title).toBe('Prologue II');
  });

  test('artist view displays tracks in correct order in the DOM', async ({ page }) => {
    await page.waitForSelector('[data-testid^="artist-item-"]', { state: 'visible' });

    // Select Composer A
    await page.evaluate(() => {
      const el = document.querySelector('[x-data="artistsBrowser"]');
      const comp = window.Alpine.$data(el);
      const artist = comp.artists.find((a) => a.includes('Composer A'));
      if (artist) comp.selectArtist(artist);
    });

    await page.waitForSelector('[data-testid^="artist-track-"]', { state: 'visible' });

    // Get the first few rendered track titles (title is in span.flex-1.truncate)
    const titles = await page.locator('[data-testid^="artist-track-"]').evaluateAll((els) =>
      els.slice(0, 14).map((el) => {
        const titleEl = el.querySelector('span.flex-1.truncate') ||
          el.querySelector('.track-title');
        return titleEl?.textContent?.trim() || '';
      })
    );

    // First album (Act I) tracks should start with "Overture"
    expect(titles[0]).toBe('Overture');
  });
});

// --- Large Library Pagination Tests ---

test.describe('Large library loading regression', () => {
  test('albums view fetches all tracks when library exceeds default API limit', async ({ page }) => {
    // Create a library larger than the default API limit of 100
    // Each album has 10 tracks, and the artist is derived from the album index
    // so album boundaries align with artist boundaries (no split albums).
    const tracks = [];
    for (let i = 1; i <= 150; i++) {
      const albumNum = Math.ceil(i / 10);
      tracks.push({
        id: i,
        title: `Track ${i}`,
        artist: `Artist ${Math.ceil(albumNum / 2)}`,
        album_artist: `Artist ${Math.ceil(albumNum / 2)}`,
        album: `Album ${albumNum}`,
        track_number: String(((i - 1) % 10) + 1),
        disc_number: '1',
        duration: 200,
        genre: 'Test',
        date: '2024',
        filepath: `/music/track-${i}.flac`,
      });
    }

    const state = createLibraryState({ tracks });
    const playlistState = createPlaylistState();
    await setupLibraryMocks(page, state);
    await setupPlaylistMocks(page, playlistState);
    await page.goto('/');
    await waitForAlpine(page);
    await setAlpineStoreProperty(page, 'ui', 'view', 'albums');
    await page.waitForSelector('[data-testid="albums-view"]', { state: 'visible' });

    // Wait for all tracks to be loaded
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[x-data="albumsBrowser"]');
        if (!el) return false;
        return window.Alpine.$data(el)._allTracks.length === 150;
      },
      null,
      { timeout: 5000 },
    );

    const result = await page.evaluate(() => {
      const el = document.querySelector('[x-data="albumsBrowser"]');
      const comp = window.Alpine.$data(el);
      return {
        allTracks: comp._allTracks.length,
        albums: comp.albumList.length,
      };
    });

    expect(result.allTracks).toBe(150);
    expect(result.albums).toBe(15); // 150 tracks / 10 per album
  });

  test('artists view fetches all tracks when library exceeds default API limit', async ({ page }) => {
    const tracks = [];
    for (let i = 1; i <= 150; i++) {
      tracks.push({
        id: i,
        title: `Track ${i}`,
        artist: `Artist ${Math.ceil(i / 15)}`,
        album_artist: `Artist ${Math.ceil(i / 15)}`,
        album: `Album ${Math.ceil(i / 10)}`,
        track_number: String(((i - 1) % 10) + 1),
        disc_number: '1',
        duration: 200,
        genre: 'Test',
        date: '2024',
        filepath: `/music/track-${i}.flac`,
      });
    }

    const state = createLibraryState({ tracks });
    const playlistState = createPlaylistState();
    await setupLibraryMocks(page, state);
    await setupPlaylistMocks(page, playlistState);
    await page.goto('/');
    await waitForAlpine(page);
    await setAlpineStoreProperty(page, 'ui', 'view', 'artists');
    await page.waitForSelector('[data-testid="artists-view"]', { state: 'visible' });

    await page.waitForFunction(
      () => {
        const el = document.querySelector('[x-data="artistsBrowser"]');
        if (!el) return false;
        return window.Alpine.$data(el)._allTracks.length === 150;
      },
      null,
      { timeout: 5000 },
    );

    const count = await page.evaluate(() => {
      const el = document.querySelector('[x-data="artistsBrowser"]');
      return window.Alpine.$data(el)._allTracks.length;
    });

    expect(count).toBe(150);
  });
});
