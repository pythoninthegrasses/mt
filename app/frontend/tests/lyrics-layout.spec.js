import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

// Real lyrics from LRCLIB cache -- short lines, narrower content width
const TRAIL_OF_DEAD_LYRICS =
  `If i could make a list\nI'd put your name on top\nOf my mistakes and regrets\nAnd every line after it\nBecause every inch of hope\n\nBecomes a world of shame\nI've had to walk through\nEach and every day\n\nAt the top of my lungs\nIt would never return\nAnd if i screamed, "you were wrong"\nAll the faith that i've lost\n\nAnd there is nothing left to say\nThat has not been said\nIf i shout, you wouldn't listen\nI don't think it'd even sink in\nIf i could make a list\n\nOf my mistakes and regrets\nI'd put your name on top\nAnd every line after it\n\nBecomes a world of shame\nBecause every inch of hope\nI've had to walk through\nEach and every day\n\nAnd there is nothing left to say\nIf i shout, you wouldn't listen\nThat has not been said\n\nI don't think it'd even sink in\nIf you forget how to feel\nReach inside your chest\nIs there a heart beating?\nIs it just emptiness? (repeat)`;

// Real lyrics from LRCLIB cache -- long lines, wider content width
const BECK_LYRICS =
  `In a cast iron cage you couldn't help but stare like a creature\nWith the laws of a brothel and the fireproof bones of a preacher\nAnd your lingo coined from the sacrament of a casino\nOn a government loan with a guillotine in your libido\n\nWho's gonna answer\nProfanity prayers\nWho's gonna answer\nThese profanity prayers\n\nWell you know how it looks when you pull all your books from the table\nAnd you stare into space trying to discern what to say now\nAnd you wait at the light and watch for a sign that you're breathing\n'Cause you can't just live on air and float to the ceiling\n\nWho's gonna answer\nProfanity prayers\nWho's gonna answer\nProfanity prayers\n\nWho's gonna answer\nProfanity prayers\nWho's gonna answer\nProfanity prayers`;

const TRAIL_OF_DEAD_TRACK = {
  id: 1,
  title: 'Mistakes & Regrets',
  artist: '...And You Will Know Us by the Trail of Dead',
  album: 'Source Tags & Codes',
  duration: 214000,
  filepath: '/music/trail-of-dead/mistakes-and-regrets.mp3',
};

const BECK_TRACK = {
  id: 2,
  title: 'Profanity Prayers',
  artist: 'Beck',
  album: 'Modern Guilt',
  duration: 209000,
  filepath: '/music/beck/profanity-prayers.mp3',
};

const INSTRUMENTAL_TRACK = {
  id: 3,
  title: 'A Brief Yet Triumphant Intermission',
  artist: 'Against Me!',
  album: 'Searching for a Former Clarity',
  duration: 47000,
  filepath: '/music/against-me/a-brief-yet-triumphant-intermission.mp3',
};

/**
 * Navigate to Now Playing view and wait for it
 * @param {import('@playwright/test').Page} page
 */
async function navigateToNowPlaying(page) {
  await page.evaluate(() => {
    window.Alpine.store('ui').view = 'nowPlaying';
  });
  await page.waitForSelector('[x-data="nowPlayingView"]', { state: 'visible' });
}

/**
 * Set current track and artwork on the player store
 * @param {import('@playwright/test').Page} page
 * @param {Object} track
 */
async function setCurrentTrack(page, track) {
  await page.evaluate((trackData) => {
    window.Alpine.store('player').currentTrack = trackData;
    window.Alpine.store('player').artwork = {
      data:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      mime_type: 'image/png',
      source: 'test',
    };
  }, track);
}

/**
 * Inject lyrics directly into the nowPlayingView Alpine component and
 * trigger the measurement pipeline.
 * @param {import('@playwright/test').Page} page
 * @param {string|null} lyricsText
 */
async function setLyrics(page, lyricsText) {
  await page.evaluate((text) => {
    const el = document.querySelector('[x-data="nowPlayingView"]');
    const data = window.Alpine.$data(el);
    data.lyrics = text;
    if (text) {
      data.$nextTick(() => data._updateLyricsScrollState());
    } else {
      data._lyricsContentWidth = null;
    }
  }, lyricsText);
}

/**
 * Wait for _lyricsContentWidth to be set (non-null)
 * @param {import('@playwright/test').Page} page
 */
async function waitForMeasurement(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[x-data="nowPlayingView"]');
      return window.Alpine.$data(el)._lyricsContentWidth !== null;
    },
    null,
    { timeout: 5000 },
  );
}

/**
 * Get the current _lyricsContentWidth value
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number|null>}
 */
async function getLyricsContentWidth(page) {
  return await page.evaluate(() => {
    const el = document.querySelector('[x-data="nowPlayingView"]');
    return window.Alpine.$data(el)._lyricsContentWidth;
  });
}

test.describe('Lyrics Layout Reflow', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('short lyrics (Trail of Dead) should size wrapper to content width', async ({ page }) => {
    await setCurrentTrack(page, TRAIL_OF_DEAD_TRACK);
    await navigateToNowPlaying(page);

    // Before lyrics: layout should not be visible
    await expect(page.locator('[data-testid="lyrics-layout"]')).not.toBeVisible();

    await setLyrics(page, TRAIL_OF_DEAD_LYRICS);
    await expect(page.locator('[data-testid="lyrics-text"]')).toBeVisible();
    await waitForMeasurement(page);

    // Wrapper should have explicit pixel width
    const lyricsWrapper = page.locator(
      '[data-testid="lyrics-layout"] > div > div:nth-child(2)',
    );
    const style = await lyricsWrapper.getAttribute('style');
    expect(style).toMatch(/width:\s*\d+(\.\d+)?px/);

    const width = await getLyricsContentWidth(page);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan(1624);
  });

  test('long lyrics (Beck) should produce wider content width than short lyrics', async ({ page }) => {
    // Use a wide viewport so width capping doesn't engage for either lyric set
    await page.setViewportSize({ width: 1920, height: 1080 });

    await setCurrentTrack(page, TRAIL_OF_DEAD_TRACK);
    await navigateToNowPlaying(page);

    // Measure short lyrics (Trail of Dead)
    await setLyrics(page, TRAIL_OF_DEAD_LYRICS);
    await waitForMeasurement(page);
    const shortWidth = await getLyricsContentWidth(page);

    // Switch to long lyrics (Beck)
    await setCurrentTrack(page, BECK_TRACK);
    await setLyrics(page, BECK_LYRICS);
    await waitForMeasurement(page);
    const longWidth = await getLyricsContentWidth(page);

    // Beck's longer lines should produce a wider measurement
    expect(longWidth).toBeGreaterThan(shortWidth);
  });

  test('instrumental track (no lyrics) should not set content width', async ({ page }) => {
    await setCurrentTrack(page, INSTRUMENTAL_TRACK);
    await navigateToNowPlaying(page);

    // Simulate lyrics not found (null)
    await setLyrics(page, null);

    const width = await getLyricsContentWidth(page);
    expect(width).toBeNull();

    // Lyrics layout should not be visible
    await expect(page.locator('[data-testid="lyrics-layout"]')).not.toBeVisible();
  });

  test('switching from lyrics to instrumental should reset layout', async ({ page }) => {
    await setCurrentTrack(page, BECK_TRACK);
    await navigateToNowPlaying(page);

    // Show lyrics first
    await setLyrics(page, BECK_LYRICS);
    await waitForMeasurement(page);
    const widthWithLyrics = await getLyricsContentWidth(page);
    expect(widthWithLyrics).toBeGreaterThan(0);

    // Switch to instrumental (lyrics not found)
    await setCurrentTrack(page, INSTRUMENTAL_TRACK);
    await setLyrics(page, null);

    const widthAfterClear = await getLyricsContentWidth(page);
    expect(widthAfterClear).toBeNull();
  });

  test('lyrics panel width should change on viewport resize', async ({ page }) => {
    await setCurrentTrack(page, BECK_TRACK);
    await navigateToNowPlaying(page);
    await setLyrics(page, BECK_LYRICS);
    await waitForMeasurement(page);

    const initialWidth = await getLyricsContentWidth(page);

    // Shrink viewport -- font uses clamp(1rem, 2vw, 1.5rem) so text width changes
    await page.setViewportSize({ width: 900, height: 700 });

    await page.waitForFunction(
      (prev) => {
        const el = document.querySelector('[x-data="nowPlayingView"]');
        const current = window.Alpine.$data(el)._lyricsContentWidth;
        return current !== null && current !== prev;
      },
      initialWidth,
      { timeout: 5000 },
    );

    const newWidth = await getLyricsContentWidth(page);
    expect(newWidth).not.toBe(initialWidth);
    expect(newWidth).toBeGreaterThan(0);
  });

  test('inner container should drop width:100% after measurement', async ({ page }) => {
    await setCurrentTrack(page, TRAIL_OF_DEAD_TRACK);
    await navigateToNowPlaying(page);
    await setLyrics(page, TRAIL_OF_DEAD_LYRICS);
    await waitForMeasurement(page);

    const innerContainer = page.locator('[data-testid="lyrics-layout"] > div');
    const style = await innerContainer.getAttribute('style');
    expect(style || '').not.toContain('width: 100%');
  });

  test('lyrics wrapper should use shrink class when measured', async ({ page }) => {
    await setCurrentTrack(page, TRAIL_OF_DEAD_TRACK);
    await navigateToNowPlaying(page);
    await setLyrics(page, TRAIL_OF_DEAD_LYRICS);
    await waitForMeasurement(page);

    const lyricsWrapper = page.locator(
      '[data-testid="lyrics-layout"] > div > div:nth-child(2)',
    );
    const classes = await lyricsWrapper.getAttribute('class');
    expect(classes).toContain('shrink');
    expect(classes).not.toContain('flex-1');
  });
});

test.describe('Lyrics Layout - Queue Viewport Regression', () => {
  test.beforeEach(async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('[x-data="libraryBrowser"]', { state: 'visible' });
  });

  test('queue panel stays fully within viewport when long lyrics are present', async ({ page }) => {
    await setCurrentTrack(page, BECK_TRACK);
    await navigateToNowPlaying(page);
    await setLyrics(page, BECK_LYRICS);
    await waitForMeasurement(page);

    const queuePanel = page.locator('[data-testid="lyrics-layout"]')
      .locator('..').locator('..').locator('> div:last-child');
    const queueBox = await queuePanel.boundingBox();
    const viewportSize = page.viewportSize();

    // Queue right edge must not exceed viewport width
    expect(queueBox.x + queueBox.width).toBeLessThanOrEqual(viewportSize.width);
    // Queue must be fully visible (left edge within viewport)
    expect(queueBox.x).toBeGreaterThanOrEqual(0);
  });

  test('queue panel maintains w-96 (384px) width with lyrics at default viewport', async ({ page }) => {
    await setCurrentTrack(page, BECK_TRACK);
    await navigateToNowPlaying(page);
    await setLyrics(page, BECK_LYRICS);
    await waitForMeasurement(page);

    // Target the Up Next queue panel directly by its heading text
    const queueHeading = page.locator('h3:has-text("Up Next")');
    const queuePanel = queueHeading.locator('..').locator('..');
    const queueBox = await queuePanel.boundingBox();

    // w-96 = 384px; allow 1px tolerance for subpixel rendering
    expect(queueBox.width).toBeGreaterThanOrEqual(383);
    expect(queueBox.width).toBeLessThanOrEqual(385);
  });

  test('queue panel stays visible at narrow viewport with long lyrics', async ({ page }) => {
    // Use a narrower viewport that previously triggered the bug
    await page.setViewportSize({ width: 1144, height: 669 });

    await setCurrentTrack(page, BECK_TRACK);
    await navigateToNowPlaying(page);
    await setLyrics(page, BECK_LYRICS);
    await waitForMeasurement(page);

    const queueHeading = page.locator('h3:has-text("Up Next")');
    await expect(queueHeading).toBeVisible();

    const queuePanel = queueHeading.locator('..').locator('..');
    const queueBox = await queuePanel.boundingBox();
    const viewportSize = page.viewportSize();

    // Queue must be fully within viewport
    expect(queueBox.x + queueBox.width).toBeLessThanOrEqual(viewportSize.width);
    expect(queueBox.x).toBeGreaterThanOrEqual(0);
    // Queue width must remain at w-96 (384px)
    expect(queueBox.width).toBeGreaterThanOrEqual(383);
  });

  test('lyrics content width is capped to available space', async ({ page }) => {
    // Narrow viewport where Beck lyrics would previously overflow
    await page.setViewportSize({ width: 1144, height: 669 });

    await setCurrentTrack(page, BECK_TRACK);
    await navigateToNowPlaying(page);
    await setLyrics(page, BECK_LYRICS);
    await waitForMeasurement(page);

    const lyricsContentWidth = await getLyricsContentWidth(page);

    // Layout container width minus fixed elements (art 320 + gap 40 + padding 16 = 376)
    const layoutWidth = await page.evaluate(() => {
      const layout = document.querySelector('[data-testid="lyrics-layout"]');
      return layout ? layout.clientWidth : 0;
    });
    const maxExpected = layoutWidth - 376;

    // Measured width must not exceed available space
    expect(lyricsContentWidth).toBeLessThanOrEqual(maxExpected + 1); // 1px tolerance
    expect(lyricsContentWidth).toBeGreaterThan(0);
  });

  test('no horizontal overflow in now playing view with long lyrics', async ({ page }) => {
    await setCurrentTrack(page, BECK_TRACK);
    await navigateToNowPlaying(page);
    await setLyrics(page, BECK_LYRICS);
    await waitForMeasurement(page);

    const hasOverflow = await page.evaluate(() => {
      return document.body.scrollWidth > window.innerWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test('no horizontal overflow at narrow viewport with long lyrics', async ({ page }) => {
    await page.setViewportSize({ width: 1144, height: 669 });

    await setCurrentTrack(page, BECK_TRACK);
    await navigateToNowPlaying(page);
    await setLyrics(page, BECK_LYRICS);
    await waitForMeasurement(page);

    const hasOverflow = await page.evaluate(() => {
      return document.body.scrollWidth > window.innerWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test('queue remains fully visible after resizing from large to small viewport with lyrics', async ({
    page,
  }) => {
    // Start at large viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await setCurrentTrack(page, BECK_TRACK);
    await navigateToNowPlaying(page);
    await setLyrics(page, BECK_LYRICS);
    await waitForMeasurement(page);

    // Capture width BEFORE resize so the value is a constant
    const prevWidth = await getLyricsContentWidth(page);

    // Shrink to the viewport size that previously caused the bug
    await page.setViewportSize({ width: 1144, height: 669 });

    // Wait for measurement to update after resize
    await page.waitForFunction(
      (prev) => {
        const el = document.querySelector('[x-data="nowPlayingView"]');
        if (!el) return false;
        const current = window.Alpine.$data(el)._lyricsContentWidth;
        return current !== null && current !== prev;
      },
      prevWidth,
      { timeout: 5000 },
    );

    const queueHeading = page.locator('h3:has-text("Up Next")');
    await expect(queueHeading).toBeVisible();

    const queuePanel = queueHeading.locator('..').locator('..');
    const queueBox = await queuePanel.boundingBox();
    const viewportSize = page.viewportSize();

    expect(queueBox.x + queueBox.width).toBeLessThanOrEqual(viewportSize.width);
    expect(queueBox.width).toBeGreaterThanOrEqual(383);
  });

  test('left panel has min-w-0 to prevent flex overflow', async ({ page }) => {
    await setCurrentTrack(page, BECK_TRACK);
    await navigateToNowPlaying(page);

    // The left panel is the first child of the main flex container (.flex.h-full)
    const leftPanel = page.locator('[x-data="nowPlayingView"] > .flex.h-full > div:first-child');
    const classes = await leftPanel.getAttribute('class');
    expect(classes).toContain('min-w-0');
  });

  test('queue panel has shrink-0 to prevent compression', async ({ page }) => {
    await setCurrentTrack(page, BECK_TRACK);
    await navigateToNowPlaying(page);

    // The queue panel is the last child of the main flex container (.flex.h-full)
    const queuePanel = page.locator('[x-data="nowPlayingView"] > .flex.h-full > div:last-child');
    const classes = await queuePanel.getAttribute('class');
    expect(classes).toContain('shrink-0');
  });

  test('short lyrics do not trigger width capping', async ({ page }) => {
    await setCurrentTrack(page, TRAIL_OF_DEAD_TRACK);
    await navigateToNowPlaying(page);
    await setLyrics(page, TRAIL_OF_DEAD_LYRICS);
    await waitForMeasurement(page);

    const lyricsContentWidth = await getLyricsContentWidth(page);

    // Short lyrics should fit naturally without capping.
    // At default viewport (1624px), the cap = viewport - queue(384) - art(320) - gap(40) - padding(16) = 864px.
    // Trail of Dead's short lines should be well under this.
    const viewportWidth = page.viewportSize().width;
    const theoreticalCap = viewportWidth - 384 - 320 - 40 - 16;

    expect(lyricsContentWidth).toBeLessThan(theoreticalCap);
    expect(lyricsContentWidth).toBeGreaterThan(0);
  });
});
