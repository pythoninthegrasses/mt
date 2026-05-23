/**
 * Store Registry
 *
 * Registers all Alpine.js stores with the Alpine instance.
 * Import this module and call initStores(Alpine) before Alpine.start().
 */

import { createPlayerStore } from './player.js';
import { createQueueStore } from './queue.js';
import { createLibraryStore } from './library.js';
import { createSettingsStore } from './settings.js';
import { createUIStore } from './ui.js';
import { initEventListeners } from '../events.js';

/**
 * Initialize all Alpine stores
 * @param {object} Alpine - Alpine.js instance
 */
export function initStores(Alpine) {
  // Register stores in dependency order
  // UI store first (no dependencies)
  createUIStore(Alpine);

  // Library store (no store dependencies, uses API)
  createLibraryStore(Alpine);

  // Player store before queue (queue.clear() calls player.stop())
  createPlayerStore(Alpine);

  // Queue store (references player and library)
  createQueueStore(Alpine);

  // Settings store (no store dependencies)
  createSettingsStore(Alpine);

  console.log('[stores] All stores registered');

  // Initialize Tauri event listeners after stores are ready
  initEventListeners(Alpine).catch((err) => {
    console.error('[stores] Failed to initialize event listeners:', err);
  });
}

export default initStores;
