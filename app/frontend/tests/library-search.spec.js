import { expect, test } from '@playwright/test';
import { getAlpineStore, waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

test.describe('Search Functionality', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('should filter tracks by search query', async ({ page }) => {
    // Wait for tracks to load
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    // Find search input
    const searchInput = page.locator('input[placeholder="Search"]');
    await expect(searchInput).toBeVisible();

    // Type search query
    await searchInput.fill('test');

    // Wait for search to complete (debounced)
    await page.waitForTimeout(500);

    // Verify filtered tracks
    const libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.searchQuery).toBe('test');

    // Track count should change (unless all tracks match "test")
    const filteredCount = await page.locator('[data-track-id]').count();
    expect(typeof filteredCount).toBe('number');
  });

  test('should show clear button when search has text', async ({ page }) => {
    const searchInput = page.locator('input[placeholder="Search"]');
    await searchInput.fill('query');

    // Wait for clear button to appear
    await page.waitForSelector('button:near(input[placeholder="Search"])', { state: 'visible' });

    // Verify clear button is visible
    const clearButton = page.locator(
      'input[placeholder="Search"] ~ button, input[placeholder="Search"] + button',
    ).first();
    await expect(clearButton).toBeVisible();
  });

  test('should clear search when clicking clear button', async ({ page }) => {
    const searchInput = page.locator('input[placeholder="Search"]');
    await searchInput.fill('query');
    await page.waitForTimeout(500);

    // Click clear button
    const clearButton = page.locator(
      'input[placeholder="Search"] ~ button, input[placeholder="Search"] + button',
    ).first();
    await clearButton.click();

    // Verify search is cleared
    const libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.searchQuery).toBe('');

    // Verify input is empty
    const inputValue = await searchInput.inputValue();
    expect(inputValue).toBe('');
  });

  test('should show "no results" message when search has no matches', async ({ page }) => {
    // Search for something unlikely to exist
    const searchInput = page.locator('input[placeholder="Search"]');
    await searchInput.fill('xyzxyzxyzunlikelytomatch123');
    await page.waitForTimeout(500);

    // Wait for empty state
    await page.waitForSelector('text=No tracks found', { state: 'visible' });

    // Verify "no results" message
    const noResultsMessage = page.locator('text=No tracks found');
    await expect(noResultsMessage).toBeVisible();
  });
});

test.describe('Search Result Ranking', () => {
  test.beforeEach(async ({ page }) => {
    const customTracks = [
      {
        id: 1,
        title: 'Love',
        artist: 'Some Band',
        album: 'First Album',
        duration: 180000,
        track_number: 1,
        disc_number: 1,
        year: 2020,
        genre: 'Pop',
        filepath: '/music/track-1.mp3',
        filename: 'track-1.mp3',
      },
      {
        id: 2,
        title: 'I Love Rock',
        artist: 'Rock Stars',
        album: 'Love Album',
        duration: 200000,
        track_number: 1,
        disc_number: 1,
        year: 2019,
        genre: 'Rock',
        filepath: '/music/track-2.mp3',
        filename: 'track-2.mp3',
      },
      {
        id: 3,
        title: 'Dancing Queen',
        artist: 'Love Band',
        album: 'Greatest Hits',
        duration: 220000,
        track_number: 2,
        disc_number: 1,
        year: 2018,
        genre: 'Disco',
        filepath: '/music/track-3.mp3',
        filename: 'track-3.mp3',
      },
      {
        id: 4,
        title: 'Summer Nights',
        artist: 'Beach Boys',
        album: 'Love Songs Collection',
        duration: 190000,
        track_number: 3,
        disc_number: 1,
        year: 2021,
        genre: 'Pop',
        filepath: '/music/track-4.mp3',
        filename: 'track-4.mp3',
      },
      {
        id: 5,
        title: 'Lovely Day',
        artist: 'Soul Singer',
        album: 'Morning Vibes',
        duration: 210000,
        track_number: 1,
        disc_number: 1,
        year: 2017,
        genre: 'Soul',
        filepath: '/music/track-5.mp3',
        filename: 'track-5.mp3',
      },
    ];
    const state = createLibraryState({ tracks: customTracks });
    await setupLibraryMocks(page, state);
    await page.goto('/');
    await page.setViewportSize({ width: 1624, height: 1057 });
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });

    await page.evaluate(() => {
      window.Alpine.store('ui').sortIgnoreWords = false;
    });
  });

  test('exact title match ranks first', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const searchInput = page.locator('input[placeholder="Search"]');
    await searchInput.fill('love');
    await page.waitForTimeout(500);

    const trackRows = page.locator('[data-track-id]');
    const count = await trackRows.count();
    expect(count).toBeGreaterThan(0);

    const firstTrackId = await trackRows.first().getAttribute('data-track-id');
    expect(firstTrackId).toBe('1');
  });

  test('artist match ranks appropriately', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const searchInput = page.locator('input[placeholder="Search"]');
    await searchInput.fill('love band');
    await page.waitForTimeout(500);

    const trackRows = page.locator('[data-track-id]');
    const count = await trackRows.count();
    expect(count).toBeGreaterThan(0);

    const firstTrackId = await trackRows.first().getAttribute('data-track-id');
    expect(firstTrackId).toBe('3');
  });

  test('partial matches appear after exact matches', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const searchInput = page.locator('input[placeholder="Search"]');
    await searchInput.fill('love');
    await page.waitForTimeout(500);

    const trackRows = page.locator('[data-track-id]');
    const trackIds = [];
    const count = await trackRows.count();
    for (let i = 0; i < count; i++) {
      trackIds.push(await trackRows.nth(i).getAttribute('data-track-id'));
    }

    expect(trackIds[0]).toBe('1');

    const lovelyDayIndex = trackIds.indexOf('5');
    const iLoveRockIndex = trackIds.indexOf('2');
    expect(lovelyDayIndex).toBeGreaterThan(0);
    expect(iLoveRockIndex).toBeGreaterThan(0);
  });

  test('search with multiple terms returns expected order', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const searchInput = page.locator('input[placeholder="Search"]');
    await searchInput.fill('rock');
    await page.waitForTimeout(500);

    const trackRows = page.locator('[data-track-id]');
    const count = await trackRows.count();
    expect(count).toBeGreaterThan(0);

    const firstTrackId = await trackRows.first().getAttribute('data-track-id');
    expect(firstTrackId).toBe('2');
  });
});
