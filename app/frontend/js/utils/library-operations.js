/**
 * Library Operations — extracted heavy methods from createLibraryStore.
 *
 * Each function receives the store instance (and Alpine where needed)
 * so the store methods become thin one-line wrappers.  Moving the logic
 * here keeps cognitive complexity out of the store factory function.
 */

import { library } from '../api/library.js';
import { promptToAddWatchedFolders } from '../utils/watched-folders.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute summary stats and update store state after a section fetch.
 * Shared between loadSection and backgroundRefreshSection.
 */
export function applySectionData(store, section, tracks, data) {
  window.Alpine.disableEffectScheduling(() => {
    store.tracks = tracks;
    store.totalTracks = data?.total ?? tracks.length;
    store.totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    store._lastLoadedSection = section;
    store.filteredTracks = [...tracks];
  });
}

/**
 * Determine the initial sidebar section from settings or localStorage.
 * Pure function — only reads from `window`.
 */
export function getInitialSection() {
  let section = 'all';

  if (window.settings?.initialized) {
    section = window.settings.get('sidebar:activeSection', section);
  } else {
    const legacySidebar = localStorage.getItem('mt:sidebar');
    if (legacySidebar) {
      try {
        const parsed = JSON.parse(legacySidebar);
        if (parsed?.activeSection) {
          section = parsed.activeSection;
        }
      } catch (_e) {
        // Ignore malformed legacy sidebar storage
      }
    }
  }

  return section;
}

// ---------------------------------------------------------------------------
// Generic section load / refresh
// ---------------------------------------------------------------------------

/**
 * Load a section's tracks with cache preview and loading state.
 * @param {object} store - Library store instance
 * @param {string} section - Section identifier (e.g. 'liked', 'recent')
 * @param {Function} fetchFn - Async function returning { tracks, total?, … }
 * @param {Object} [opts]
 * @param {Function} [opts.transform] - Transform raw tracks (default: store._filterByLibrary)
 * @param {Function} [opts.onSuccess] - Post-success callback receiving (data)
 * @param {string} [opts.logTag] - Log tag override (default: 'library')
 * @returns {*} Return value from onSuccess, or undefined
 */
export async function loadSection(store, section, fetchFn, opts = {}) {
  const { transform, onSuccess, logTag = 'library' } = opts;
  const cached = store._sectionCache[section];

  // Show cached summary stats if available (previous tracks stay visible during fetch)
  if (cached) {
    console.log(`[${logTag}]`, `load_${section}_with_cache_summary`, {
      totalTracks: cached.totalTracks,
    });
    store.totalTracks = cached.totalTracks;
    store.totalDuration = cached.totalDuration;
    store._lastLoadedSection = section;
  }

  store.loading = true;
  // DON'T clear tracks - keep showing previous data while loading
  try {
    const data = await fetchFn();
    const rawTracks = data.tracks || [];
    const tracks = transform ? transform(rawTracks, data) : store._filterByLibrary(rawTracks);
    applySectionData(store, section, tracks, { total: tracks.length });
    store._updateCache(section, { tracks, total: tracks.length });

    if (onSuccess) {
      return onSuccess(data);
    }
  } catch (error) {
    console.error(`[${logTag}] Failed to load ${section}:`, error);
    store.tracks = [];
    store.filteredTracks = [];
  } finally {
    store.loading = false;
  }
}

/**
 * Silently refresh a section's data in the background.
 * @param {object} store - Library store instance
 * @param {string} section - Section identifier
 * @param {Function} fetchFn - Async function returning { tracks, total?, … }
 * @param {Object} [opts]
 * @param {Function} [opts.transform] - Transform raw tracks (default: store._filterByLibrary)
 * @param {Function} [opts.onSuccess] - Post-success callback receiving (data)
 */
export async function backgroundRefreshSection(store, section, fetchFn, opts = {}) {
  if (store._backgroundRefreshing) return;
  store._backgroundRefreshing = true;
  const { transform, onSuccess } = opts;

  try {
    const data = await fetchFn();
    if (store._lastLoadedSection === section) {
      const rawTracks = data.tracks || [];
      const tracks = transform ? transform(rawTracks, data) : store._filterByLibrary(rawTracks);
      applySectionData(store, section, tracks, { total: tracks.length });
      store._updateCache(section, { tracks, total: tracks.length });
      if (onSuccess) onSuccess(data);
    }
  } catch (e) {
    console.log(`[library] background refresh ${section} failed:`, e.message);
  } finally {
    store._backgroundRefreshing = false;
  }
}

// ---------------------------------------------------------------------------
// Main library load / refresh (the "all" section)
// ---------------------------------------------------------------------------

/**
 * Load library tracks from backend.
 * @param {object} store - Library store instance
 * @param {Object} [options]
 * @param {boolean} [options.forceReload=false] - Force reload even if data exists
 */
export async function loadLibraryData(store, { forceReload = false } = {}) {
  if (store.currentSection?.startsWith('playlist-')) {
    console.log('[library]', 'load_skipped', {
      reason: 'playlist_view',
      section: store.currentSection,
    });
    return;
  }

  const loadSection = store.currentSection;
  const cached = store._sectionCache[loadSection];

  // Show cached summary stats if available (previous tracks stay visible during fetch)
  if (cached && !forceReload) {
    console.log('[library]', 'load_with_cache_summary', {
      section: loadSection,
      totalTracks: cached.totalTracks,
      cacheAge: Math.round((Date.now() - cached.timestamp) / 1000) + 's',
    });
    store.totalTracks = cached.totalTracks;
    store.totalDuration = cached.totalDuration;
    store._lastLoadedSection = loadSection;
    // Fall through to fetch below — tracks stay from previous section (no flash)
  }

  console.log('[library]', 'load', {
    action: 'loading_library',
    section: loadSection,
    forceReload,
    hasCachedData: !!cached,
  });

  store.loading = true;
  // DON'T clear tracks - keep showing previous data while loading
  // This prevents spinner from showing when switching between sections
  // The spinner only shows when library.loading && library.tracks.length === 0

  try {
    const _t0 = performance.now();
    const data = await store._fetchLibraryData();
    const _t1 = performance.now();

    if (store.currentSection !== loadSection || store.currentSection?.startsWith('playlist-')) {
      console.log('[library]', 'load_discarded', {
        startedIn: loadSection,
        currentSection: store.currentSection,
      });
      return;
    }

    const rawTracks = data.tracks || [];
    const _t2 = performance.now();

    window.Alpine.disableEffectScheduling(() => {
      store.tracks = rawTracks;
      store.totalTracks = data.total || rawTracks.length;
      store.totalDuration = rawTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
      store._lastLoadedSection = loadSection;
      store.allTracks = rawTracks;
      store._dataVersion++;
      store.filteredTracks = [...rawTracks];
    });
    store._updateCache(loadSection, data);
    const _t3 = performance.now();

    // applyFilters inlined into the batch above
    const _t4 = performance.now();

    window._perfLibLoad = {
      fetch_ms: Math.round(_t1 - _t0),
      assign_tracks_ms: Math.round(_t2 - _t1),
      process_ms: Math.round(_t3 - _t2),
      applyFilters_ms: Math.round(_t4 - _t3),
      total_ms: Math.round(_t4 - _t0),
    };
    console.log('[perf] library.load breakdown:', window._perfLibLoad);
    console.log('[library]', 'load_complete', {
      trackCount: store.tracks.length,
      totalDuration: Math.round(store.totalDuration / 1000) + 's',
      section: loadSection,
    });
  } catch (error) {
    console.error('[library]', 'load_error', { error: error.message });
    // Ensure tracks stay cleared on error
    store.tracks = [];
    store.filteredTracks = [];
  } finally {
    store.loading = false;
  }
}

/**
 * Silently refresh the main library data in background without spinner.
 * @param {object} store - Library store instance
 * @param {string} section - Current section to refresh
 */
export async function backgroundRefreshLibrary(store, section) {
  if (store._backgroundRefreshing) return;
  store._backgroundRefreshing = true;

  try {
    console.log('[library] background refresh starting for:', section);
    const data = await store._fetchLibraryData();

    // _fetchLibraryData always returns the full library
    const refreshedTracks = data.tracks || [];

    // Only update section-specific state if still on same section
    if (store.currentSection === section) {
      window.Alpine.disableEffectScheduling(() => {
        store.allTracks = refreshedTracks;
        store._dataVersion++;
        store.tracks = refreshedTracks;
        store.totalTracks = data.total || refreshedTracks.length;
        store.totalDuration = refreshedTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        store.filteredTracks = [...refreshedTracks];
      });
      store._updateCache(section, data);

      console.log('[library] background refresh complete:', {
        section,
        trackCount: store.tracks.length,
      });
    } else {
      window.Alpine.disableEffectScheduling(() => {
        store.allTracks = refreshedTracks;
        store._dataVersion++;
      });
    }
  } catch (error) {
    // Silent fail for background refresh
    console.log('[library] background refresh failed:', error.message);
  } finally {
    store._backgroundRefreshing = false;
  }
}

// ---------------------------------------------------------------------------
// Scan operations
// ---------------------------------------------------------------------------

/**
 * Scan paths for music files.
 * @param {object} store - Library store instance
 * @param {string[]} paths - File or directory paths to scan
 * @param {boolean} [recursive=true] - Scan subdirectories
 */
export async function scanPaths(store, paths, recursive = true) {
  if (!paths || paths.length === 0) {
    console.log('[library] scan: no paths provided');
    return { added: 0, skipped: 0, errors: 0 };
  }

  console.log('[library] scan: scanning', paths.length, 'paths:', paths);
  store.scanning = true;
  store.scanProgress = 0;

  try {
    const result = await library.scan(paths, recursive);
    console.log('[library] scan result:', result);

    await store.load({ forceReload: true });

    return result;
  } catch (error) {
    console.error('[library] scan failed:', error);
    throw error;
  } finally {
    store.scanning = false;
    store.scanProgress = 0;
  }
}

/**
 * Show a toast summarizing scan results.
 */
function showScanResultToast(ui, result) {
  if (result.added > 0) {
    ui.toast(
      `Added ${result.added} track${result.added === 1 ? '' : 's'} to library`,
      'success',
    );
  } else if (result.skipped > 0) {
    ui.toast(
      `All ${result.skipped} track${result.skipped === 1 ? '' : 's'} already in library`,
      'info',
    );
  } else {
    ui.toast('No audio files found', 'info');
  }
}

/**
 * Open native file dialog and scan selected paths.
 * @param {object} store - Library store instance
 * @param {object} Alpine - Alpine.js instance
 */
export async function openAddMusicDialogOp(store, Alpine) {
  try {
    console.log('[library] opening add music dialog...');

    if (!window.__TAURI__) {
      throw new Error('Tauri not available');
    }

    const { invoke } = window.__TAURI__.core;
    const paths = await invoke('open_add_music_dialog');

    console.log('[library] dialog returned paths:', paths);

    if (!paths || (Array.isArray(paths) && paths.length === 0)) {
      console.log('[library] dialog cancelled or no paths selected');
      return null;
    }

    const pathArray = Array.isArray(paths) ? paths : [paths];
    const result = await store.scan(pathArray);
    showScanResultToast(Alpine.store('ui'), result);

    // Prompt to add parent directories to watched folders
    try {
      await promptToAddWatchedFolders(pathArray);
    } catch (error) {
      console.error('[library] Failed to add watched folders:', error);
    }

    return result;
  } catch (error) {
    console.error('[library] openAddMusicDialog failed:', error);
    Alpine.store('ui').toast('Failed to add music', 'error');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Track state management
// ---------------------------------------------------------------------------

/**
 * Remove tracks from queue by ID set.
 * Handles index adjustments and playback state.
 * @param {object} Alpine - Alpine.js instance
 * @param {Set} idSet - Set of track IDs to remove
 */
export function removeFromQueue(Alpine, idSet) {
  const queue = Alpine.store('queue');
  const indicesToRemove = [];
  for (let i = queue.items.length - 1; i >= 0; i--) {
    if (idSet.has(queue.items[i].id)) {
      indicesToRemove.push(i);
    }
  }
  // Remove in reverse order so indices stay valid
  for (const idx of indicesToRemove) {
    queue.items.splice(idx, 1);
    if (idx < queue.currentIndex) {
      queue.currentIndex--;
    } else if (idx === queue.currentIndex) {
      if (queue.items.length === 0) {
        queue.currentIndex = -1;
        Alpine.store('player').stop();
      } else if (queue.currentIndex >= queue.items.length) {
        queue.currentIndex = queue.items.length - 1;
      }
    }
  }
  if (queue._originalOrder) {
    queue._originalOrder = queue._originalOrder.filter((t) => !idSet.has(t.id));
  }
}

/**
 * Remove tracks from local state without IPC calls.
 * Used by the event system and optimistic UI updates.
 * @param {object} store - Library store instance
 * @param {object} Alpine - Alpine.js instance
 * @param {number[]} trackIds - Track IDs to remove
 */
export function removeTracksLocallyOp(store, Alpine, trackIds) {
  if (!trackIds || trackIds.length === 0) return;

  // Fast path: clearing the entire library — skip reactive filtering
  if (trackIds.length >= store.allTracks.length) {
    store.allTracks = [];
    store._dataVersion++;
    store.tracks = [];
    store.filteredTracks = [];
    store.totalTracks = 0;
    store.totalDuration = 0;
    store._clearCache();

    const queue = Alpine.store('queue');
    queue.items = [];
    queue._originalOrder = [];
    queue.currentIndex = -1;
    Alpine.store('player').stop();
    return;
  }

  const idSet = new Set(trackIds);
  const newAllTracks = store.allTracks.filter((t) => !idSet.has(t.id));
  const newTracks = store.tracks.filter((t) => !idSet.has(t.id));
  // Filter filteredTracks directly — removing items from a sorted list preserves
  // sort order, so re-running applyFilters() (O(n log n) sort) is unnecessary.
  const newFilteredTracks = store.filteredTracks.filter((t) => !idSet.has(t.id));

  window.Alpine.disableEffectScheduling(() => {
    store.allTracks = newAllTracks;
    store._dataVersion++;
    store.tracks = newTracks;
    store.totalTracks = newTracks.length;
    store.totalDuration = newTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    store.filteredTracks = newFilteredTracks;
  });
  store._clearCache();

  // Remove from queue if present
  removeFromQueue(Alpine, idSet);
}
