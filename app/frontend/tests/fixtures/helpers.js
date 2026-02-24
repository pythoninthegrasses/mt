/**
 * Test helper utilities for E2E tests
 *
 * Provides common functions for interacting with Alpine.js stores,
 * waiting for conditions, and performing common test actions.
 */

/**
 * Get Alpine.js store data from the page
 * @param {import('@playwright/test').Page} page
 * @param {string} storeName - Name of the store (e.g., 'player', 'queue', 'library', 'ui')
 * @returns {Promise<Object>} Store data
 */
export async function getAlpineStore(page, storeName) {
  return await page.evaluate((name) => {
    return window.Alpine.store(name);
  }, storeName);
}

/**
 * Update Alpine.js store property
 * @param {import('@playwright/test').Page} page
 * @param {string} storeName - Name of the store
 * @param {string} property - Property to update
 * @param {any} value - New value
 */
export async function setAlpineStoreProperty(page, storeName, property, value) {
  await page.evaluate(
    ({ name, prop, val }) => {
      window.Alpine.store(name)[prop] = val;
    },
    { name: storeName, prop: property, val: value }
  );
}

/**
 * Call Alpine.js store method
 * @param {import('@playwright/test').Page} page
 * @param {string} storeName - Name of the store
 * @param {string} method - Method to call
 * @param {...any} args - Arguments to pass to the method
 * @returns {Promise<any>} Return value of the method
 */
export async function callAlpineStoreMethod(page, storeName, method, ...args) {
  return await page.evaluate(
    ({ name, methodName, methodArgs }) => {
      return window.Alpine.store(name)[methodName](...methodArgs);
    },
    { name: storeName, methodName: method, methodArgs: args }
  );
}

/**
 * Wait for Alpine.js to be ready
 * @param {import('@playwright/test').Page} page
 */
export async function waitForAlpine(page) {
  await page.waitForFunction(() => {
    return window.Alpine && window.Alpine.store;
  });
}

/**
 * Wait for Alpine.js store to have specific value
 * @param {import('@playwright/test').Page} page
 * @param {string} storeName - Name of the store
 * @param {string} property - Property to check
 * @param {any} expectedValue - Expected value
 * @param {Object} options - Options (timeout, etc.)
 */
export async function waitForStoreValue(
  page,
  storeName,
  property,
  expectedValue,
  options = {}
) {
  await page.waitForFunction(
    ({ name, prop, expected }) => {
      const store = window.Alpine.store(name);
      return store && store[prop] === expected;
    },
    { name: storeName, prop: property, expected: expectedValue },
    options
  );
}

/**
 * Wait for Alpine.js store property to change
 * @param {import('@playwright/test').Page} page
 * @param {string} storeName - Name of the store
 * @param {string} property - Property to watch
 * @param {number} timeout - Timeout in ms
 */
export async function waitForStoreChange(page, storeName, property, timeout = 5000) {
  const initialValue = await page.evaluate(
    ({ name, prop }) => window.Alpine.store(name)[prop],
    { name: storeName, prop: property }
  );

  await page.waitForFunction(
    ({ name, prop, initial }) => {
      return window.Alpine.store(name)[prop] !== initial;
    },
    { name: storeName, prop: property, initial: initialValue },
    { timeout }
  );
}

/**
 * Format duration as MM:SS for comparison
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
export function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Click a track row by index
 * @param {import('@playwright/test').Page} page
 * @param {number} index - Track index (0-based)
 */
export async function clickTrackRow(page, index) {
  await page.locator('[data-track-id]').nth(index).click();
}

/**
 * Double-click a track row by index
 * @param {import('@playwright/test').Page} page
 * @param {number} index - Track index (0-based)
 */
export async function doubleClickTrackRow(page, index) {
  await page.locator('[data-track-id]').nth(index).dblclick();
}

/**
 * Wait for player to be playing
 * @param {import('@playwright/test').Page} page
 */
export async function waitForPlaying(page) {
  await waitForStoreValue(page, 'player', 'isPlaying', true);
}

/**
 * Wait for player to be paused
 * @param {import('@playwright/test').Page} page
 */
export async function waitForPaused(page) {
  await waitForStoreValue(page, 'player', 'isPlaying', false);
}

/**
 * Get current track from player store
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Object|null>} Current track or null
 */
export async function getCurrentTrack(page) {
  const playerStore = await getAlpineStore(page, 'player');
  return playerStore.currentTrack;
}

/**
 * Get queue items
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array>} Queue items
 */
export async function getQueueItems(page) {
  const queueStore = await getAlpineStore(page, 'queue');
  return queueStore.items;
}

