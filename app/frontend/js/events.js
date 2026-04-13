/**
 * Tauri Event System for real-time updates
 *
 * This module centralizes all Tauri event subscriptions, replacing the WebSocket
 * connection from the Python backend. Events are emitted from the Rust backend
 * using app.emit() and received here using window.__TAURI__.event.listen().
 *
 * Event naming convention: `domain:action` (e.g., `library:updated`)
 */

import { removeFromQueue } from './utils/library-operations.js';

const { listen } = window.__TAURI__?.event ?? {
  listen: () => Promise.resolve(() => {}),
};

// Store unlisten functions for cleanup
const listeners = [];

/**
 * Event names matching Rust backend events
 */
export const Events = {
  // Library events
  LIBRARY_UPDATED: 'library:updated',
  LIBRARY_RECONCILE: 'library:reconcile',
  SCAN_PROGRESS: 'library:scan-progress',
  SCAN_COMPLETE: 'library:scan-complete',

  // Queue events
  QUEUE_UPDATED: 'queue:updated',
  QUEUE_STATE_CHANGED: 'queue:state-changed',

  // Favorites events
  FAVORITES_UPDATED: 'favorites:updated',

  // Playlist events
  PLAYLISTS_UPDATED: 'playlists:updated',

  // Settings events (Tauri Store)
  SETTINGS_CHANGED: 'settings://changed',
  SETTINGS_RESET: 'settings://reset',
};

/**
 * Subscribe to a Tauri event
 * @param {string} event - Event name
 * @param {Function} callback - Callback function receiving event payload
 * @returns {Promise<Function>} Unlisten function
 */
export async function subscribe(event, callback) {
  const unlisten = await listen(event, (e) => {
    console.debug(`[events] ${event}:`, e.payload);
    callback(e.payload);
  });
  listeners.push(unlisten);
  return unlisten;
}

// --- Individual event handlers ---

function createLibraryUpdatedHandler(Alpine) {
  let refreshTimer = null;
  function debouncedFetchTracks(library) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      library.fetchTracks();
    }, 500);
  }

  return (payload) => {
    const { action, track_ids } = payload;
    const library = Alpine.store('library');

    console.log(
      `[events] Library ${action}:`,
      track_ids.length ? `${track_ids.length} tracks` : 'bulk update',
    );

    // Deletions are handled by library:reconcile event with authoritative stats
    if (action === 'added' || action === 'modified') {
      debouncedFetchTracks(library);
    }
  };
}

function handleScanProgress(Alpine, payload) {
  const { job_id, status, scanned, found, errors, current_path } = payload;
  const library = Alpine.store('library');

  if (library.setScanProgress) {
    library.setScanProgress({
      jobId: job_id,
      status,
      scanned,
      found,
      errors,
      currentPath: current_path,
    });
  }
}

function handleScanComplete(Alpine, payload) {
  const { added, skipped, errors, duration_ms } = payload;
  const library = Alpine.store('library');

  console.log(
    `[events] Scan complete: ${added} added, ${skipped} skipped, ${errors} errors (${duration_ms}ms)`,
  );

  if (library.clearScanProgress) {
    library.clearScanProgress();
  }
  // Track refresh is handled by library:reconcile event with authoritative stats
}

function createQueueUpdatedHandler(Alpine) {
  let queueReloadDebounce = null;

  return (payload) => {
    console.log('[events] queue:updated', payload);

    const queue = Alpine.store('queue');
    if (queue?._initializing || queue?._updating) {
      console.log(
        '[events] Skipping queue reload during',
        queue._initializing ? 'initialization' : 'active update',
      );
      return;
    }

    if (queueReloadDebounce) {
      clearTimeout(queueReloadDebounce);
    }

    queueReloadDebounce = setTimeout(() => {
      const queue = Alpine.store('queue');
      if (queue && queue.load && !queue._initializing && !queue._updating) {
        queue.load();
      }
    }, 100);
  };
}

function handleQueueStateChanged(Alpine, payload) {
  console.log('[events] queue:state-changed', payload);

  const queue = Alpine.store('queue');
  if (queue && !queue._initializing && !queue._updating) {
    queue.currentIndex = payload.current_index;
    queue.shuffle = payload.shuffle_enabled;
    queue.loop = payload.loop_mode;
  } else if (queue?._initializing || queue?._updating) {
    console.log(
      '[events] Skipping queue state update during',
      queue._initializing ? 'initialization' : 'active update',
    );
  }
}

function handleLibraryReconcile(Alpine, payload) {
  const {
    mutation,
    affected_sections,
    removed_ids,
    total_tracks,
    total_duration,
    revision,
  } = payload;
  const library = Alpine.store('library');

  console.log(
    `[events] Library reconcile (${mutation}): total=${total_tracks}, removed=${removed_ids.length}`,
  );

  // Apply authoritative totals from backend
  window.Alpine.disableEffectScheduling(() => {
    library.totalTracks = total_tracks;
    library.totalDuration = total_duration;
  });
  library._lastRevision = revision;

  if (
    (mutation === 'delete' || mutation === 'dedup') &&
    removed_ids.length > 0
  ) {
    // Targeted removal: filter IDs from local view, queue cleanup
    const idSet = new Set(removed_ids);
    library._removeFromView(idSet);
    removeFromQueue(Alpine, idSet);
  } else if (
    mutation === 'scan_complete' ||
    mutation === 'delete' ||
    mutation === 'dedup'
  ) {
    // Bulk change: full refetch
    library.fetchTracks();
  }

  // Refresh if currently viewing an affected section
  if (
    affected_sections.includes('liked') &&
    library.currentSection === 'liked'
  ) {
    library.fetchTracks();
  }
}

function handleFavoritesUpdated(Alpine, payload) {
  const { action, track_id } = payload;
  const library = Alpine.store('library');
  const player = Alpine.store('player');

  console.log(`[events] Favorites ${action}: track ${track_id}`);

  if (library.refreshIfLikedSongs) {
    library.refreshIfLikedSongs();
  }

  if (player.currentTrack?.id === track_id) {
    player.isFavorite = action === 'added';
  }
}

function handlePlaylistsUpdated(Alpine, payload) {
  const { action, playlist_id } = payload;
  const library = Alpine.store('library');

  console.log(`[events] Playlists ${action}: playlist ${playlist_id}`);

  if (library._clearCache && playlist_id) {
    library._clearCache(`playlist-${playlist_id}`);
  }

  if (library.loadPlaylists) {
    library.loadPlaylists();
  }

  if (library.activePlaylistId === playlist_id && library.loadPlaylistTracks) {
    library.loadPlaylistTracks(playlist_id);
  }
}

function handleSettingsChanged(Alpine, payload) {
  const { key, value } = payload;

  console.log(`[events] Settings changed: ${key} =`, value);

  const ui = Alpine.store('ui');
  const player = Alpine.store('player');

  switch (key) {
    case 'volume':
      if (player && typeof value === 'number') {
        player.volume = value;
      }
      break;
    case 'theme':
      if (ui && typeof value === 'string') {
        ui.theme = value;
        ui.applyTheme();
      }
      break;
    case 'sidebar_width':
      if (ui && typeof value === 'number') {
        ui.sidebarWidth = value;
      }
      break;
    // shuffle and loop_mode are session-only, managed by queue store locally
    default:
      console.debug(`[events] Unhandled settings change: ${key}`);
  }
}

/**
 * Initialize all event listeners
 * Call this during app startup to set up event handlers
 * @param {object} Alpine - Alpine.js instance
 */
export async function initEventListeners(Alpine) {
  console.log('[events] Initializing Tauri event listeners...');

  await subscribe(Events.LIBRARY_UPDATED, createLibraryUpdatedHandler(Alpine));
  await subscribe(Events.LIBRARY_RECONCILE, (p) => handleLibraryReconcile(Alpine, p));
  await subscribe(Events.SCAN_PROGRESS, (p) => handleScanProgress(Alpine, p));
  await subscribe(Events.SCAN_COMPLETE, (p) => handleScanComplete(Alpine, p));
  await subscribe(Events.QUEUE_UPDATED, createQueueUpdatedHandler(Alpine));
  await subscribe(Events.QUEUE_STATE_CHANGED, (p) => handleQueueStateChanged(Alpine, p));
  await subscribe(Events.FAVORITES_UPDATED, (p) => handleFavoritesUpdated(Alpine, p));
  await subscribe(Events.PLAYLISTS_UPDATED, (p) => handlePlaylistsUpdated(Alpine, p));
  await subscribe(Events.SETTINGS_CHANGED, (p) => handleSettingsChanged(Alpine, p));
  await subscribe(Events.SETTINGS_RESET, () => {
    console.log('[events] Settings reset to defaults');
  });

  console.log('[events] Tauri event listeners initialized');
}

/**
 * Cleanup all event listeners
 * Call this when the app is closing
 */
export function cleanupEventListeners() {
  console.log('[events] Cleaning up event listeners...');
  listeners.forEach((unlisten) => unlisten());
  listeners.length = 0;
}

export default {
  Events,
  subscribe,
  initEventListeners,
  cleanupEventListeners,
};
