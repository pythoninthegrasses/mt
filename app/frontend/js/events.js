/**
 * Tauri Event System for real-time updates
 *
 * This module centralizes all Tauri event subscriptions, replacing the WebSocket
 * connection from the Python backend. Events are emitted from the Rust backend
 * using app.emit() and received here using window.__TAURI__.event.listen().
 *
 * Event naming convention: `domain:action` (e.g., `library:updated`)
 */

const { listen } = window.__TAURI__?.event ?? { listen: () => Promise.resolve(() => {}) };

// Store unlisten functions for cleanup
const listeners = [];

/**
 * Event names matching Rust backend events
 */
export const Events = {
  // Library events
  LIBRARY_UPDATED: 'library:updated',
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

/**
 * Initialize all event listeners
 * Call this during app startup to set up event handlers
 * @param {object} Alpine - Alpine.js instance
 */
export async function initEventListeners(Alpine) {
  console.log('[events] Initializing Tauri event listeners...');

  // Debounced library refresh — coalesces rapid-fire events (e.g. during scanning)
  let refreshTimer = null;
  function debouncedFetchTracks(library) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      library.fetchTracks();
    }, 500);
  }

  // Library updated event
  await subscribe(Events.LIBRARY_UPDATED, (payload) => {
    const { action, track_ids } = payload;
    const library = Alpine.store('library');

    console.log(
      `[events] Library ${action}:`,
      track_ids.length ? `${track_ids.length} tracks` : 'bulk update',
    );

    // Refresh library data based on action
    if (action === 'deleted' && track_ids.length > 0) {
      // Targeted removal — no full reload needed
      library.removeTracksLocally(track_ids);
    } else if (action === 'added' || action === 'modified' || action === 'deleted') {
      // Debounced refresh — prevents UI freeze from rapid events during scanning
      debouncedFetchTracks(library);
    }
  });

  // Scan progress event
  await subscribe(Events.SCAN_PROGRESS, (payload) => {
    const { job_id, status, scanned, found, errors, current_path } = payload;
    const library = Alpine.store('library');

    // Update scan progress in library store
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
  });

  // Scan complete event
  await subscribe(Events.SCAN_COMPLETE, (payload) => {
    const { added, skipped, errors, duration_ms } = payload;
    const library = Alpine.store('library');

    console.log(
      `[events] Scan complete: ${added} added, ${skipped} skipped, ${errors} errors (${duration_ms}ms)`,
    );

    // Clear scan progress and refresh library
    if (library.clearScanProgress) {
      library.clearScanProgress();
    }
    library.fetchTracks();
  });

  // Queue updated event - with debouncing to prevent race conditions
  let queueReloadDebounce = null;

  await subscribe(Events.QUEUE_UPDATED, (payload) => {
    console.log('[events] queue:updated', payload);

    // Skip if we're actively updating the queue (prevents race conditions)
    const queue = Alpine.store('queue');
    if (queue?._initializing || queue?._updating) {
      console.log(
        '[events] Skipping queue reload during',
        queue._initializing ? 'initialization' : 'active update',
      );
      return;
    }

    // Debounce rapid queue updates to prevent race conditions
    if (queueReloadDebounce) {
      clearTimeout(queueReloadDebounce);
    }

    queueReloadDebounce = setTimeout(() => {
      const queue = Alpine.store('queue');
      // Double-check flag hasn't been set during debounce period
      if (queue && queue.load && !queue._initializing && !queue._updating) {
        queue.load();
      }
    }, 100); // 100ms debounce
  });

  // Queue state changed event (shuffle, loop mode, current index)
  await subscribe(Events.QUEUE_STATE_CHANGED, (payload) => {
    console.log('[events] queue:state-changed', payload);

    // Update local state from backend event (skip during initialization or active updates to prevent race conditions)
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
  });

  // Favorites updated event
  await subscribe(Events.FAVORITES_UPDATED, (payload) => {
    const { action, track_id } = payload;
    const library = Alpine.store('library');
    const player = Alpine.store('player');

    console.log(`[events] Favorites ${action}: track ${track_id}`);

    // Refresh library if showing liked songs
    if (library.refreshIfLikedSongs) {
      library.refreshIfLikedSongs();
    }

    // Update player favorite status if currently playing this track
    if (player.currentTrack?.id === track_id) {
      player.isFavorite = action === 'added';
    }
  });

  // Playlists updated event
  await subscribe(Events.PLAYLISTS_UPDATED, (payload) => {
    const { action, playlist_id } = payload;
    const library = Alpine.store('library');

    console.log(`[events] Playlists ${action}: playlist ${playlist_id}`);

    // Clear playlist cache for this playlist (tracks may have changed)
    if (library._clearCache && playlist_id) {
      library._clearCache(`playlist-${playlist_id}`);
    }

    // Refresh playlists
    if (library.loadPlaylists) {
      library.loadPlaylists();
    }

    // If showing this playlist, refresh its tracks
    if (library.activePlaylistId === playlist_id && library.loadPlaylistTracks) {
      library.loadPlaylistTracks(playlist_id);
    }
  });

  // Settings changed event (from Tauri Store)
  await subscribe(Events.SETTINGS_CHANGED, (payload) => {
    const { key, value } = payload;

    console.log(`[events] Settings changed: ${key} =`, value);

    // Apply settings changes to relevant stores
    const ui = Alpine.store('ui');
    const player = Alpine.store('player');

    switch (key) {
      case 'volume':
        // Volume is managed by the player store
        if (player && typeof value === 'number') {
          player.volume = value;
        }
        break;
      case 'theme':
        // Theme is managed by the UI store
        if (ui && typeof value === 'string') {
          ui.theme = value;
          ui.applyTheme();
        }
        break;
      case 'sidebar_width':
        // Sidebar width is managed by the UI store
        if (ui && typeof value === 'number') {
          ui.sidebarWidth = value;
        }
        break;
      // shuffle and loop_mode are session-only, managed by queue store locally
      default:
        console.debug(`[events] Unhandled settings change: ${key}`);
    }
  });

  // Settings reset event (from Tauri Store)
  await subscribe(Events.SETTINGS_RESET, () => {
    console.log('[events] Settings reset to defaults');
    // Could trigger a full settings reload here if needed
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
