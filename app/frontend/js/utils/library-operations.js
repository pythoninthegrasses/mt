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
 * Sets _sectionTracks for non-paginated sections.
 */
export function applySectionData(store, section, tracks, data) {
  window.Alpine.disableEffectScheduling(() => {
    store._setSectionTracks(tracks);
    store.totalTracks = data?.total ?? tracks.length;
    store.totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    store._lastLoadedSection = section;
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
    store._setSectionTracks([]);
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
// Main library load / refresh (the "all" section) — paginated
// ---------------------------------------------------------------------------

/**
 * Load library tracks from backend using pagination.
 * Fetches count + first page only; remaining pages load on demand via scroll.
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
  }

  console.log('[library]', 'load', {
    action: 'loading_library',
    section: loadSection,
    forceReload,
    hasCachedData: !!cached,
  });

  store.loading = true;

  try {
    const _t0 = performance.now();

    // Reset to paginated mode
    store._resetPages();

    // Fetch count and first page in parallel
    const filterParams = store._getFilterParams();
    const [countData] = await Promise.all([
      library.getCount(filterParams),
      store._fetchPage(0),
    ]);

    const _t1 = performance.now();

    if (store.currentSection !== loadSection || store.currentSection?.startsWith('playlist-')) {
      console.log('[library]', 'load_discarded', {
        startedIn: loadSection,
        currentSection: store.currentSection,
      });
      return;
    }

    window.Alpine.disableEffectScheduling(() => {
      store.totalTracks = countData.total;
      store.totalDuration = countData.total_duration;
      store._lastLoadedSection = loadSection;
      store._dataVersion++;
    });

    store._updateCache(loadSection, {
      total: countData.total,
      totalDuration: countData.total_duration,
    });
    const _t2 = performance.now();

    window._perfLibLoad = {
      fetch_ms: Math.round(_t1 - _t0),
      process_ms: Math.round(_t2 - _t1),
      total_ms: Math.round(_t2 - _t0),
      page0_tracks: store._trackPages[0]?.length || 0,
      total_tracks: countData.total,
    };
    console.log('[perf] library.load breakdown:', window._perfLibLoad);
    console.log('[library]', 'load_complete', {
      page0Count: store._trackPages[0]?.length || 0,
      totalTracks: countData.total,
      section: loadSection,
    });
  } catch (error) {
    console.error('[library]', 'load_error', { error: error.message });
    store._resetPages();
    store.totalTracks = 0;
    store.totalDuration = 0;
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

    const filterParams = store._getFilterParams();
    const countData = await library.getCount(filterParams);

    if (store.currentSection === section) {
      // Reset and reload page 0
      store._resetPages();
      await store._fetchPage(0);

      window.Alpine.disableEffectScheduling(() => {
        store.totalTracks = countData.total;
        store.totalDuration = countData.total_duration;
        store._dataVersion++;
      });
      store._updateCache(section, {
        total: countData.total,
        totalDuration: countData.total_duration,
      });

      console.log('[library] background refresh complete:', {
        section,
        totalTracks: countData.total,
        page0Count: store._trackPages[0]?.length || 0,
      });
    }
  } catch (error) {
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

  const currentTracks = store.filteredTracks;

  // Fast path: clearing the entire library
  if (trackIds.length >= currentTracks.length) {
    window.Alpine.disableEffectScheduling(() => {
      store._resetPages();
      store._setSectionTracks([]);
      store.totalTracks = 0;
      store.totalDuration = 0;
      store._dataVersion++;
    });
    store._clearCache();

    const queue = Alpine.store('queue');
    queue.items = [];
    queue._originalOrder = [];
    queue.currentIndex = -1;
    Alpine.store('player').stop();
    return;
  }

  const idSet = new Set(trackIds);
  let removedCount = 0;

  if (store._sectionTracks) {
    // Non-paginated section: filter the flat array
    const newTracks = store._sectionTracks.filter((t) => !idSet.has(t.id));
    removedCount = store._sectionTracks.length - newTracks.length;
    const newDuration = newTracks.reduce((sum, t) => sum + (t.duration || 0), 0);

    window.Alpine.disableEffectScheduling(() => {
      store._setSectionTracks(newTracks);
      store.totalTracks = newTracks.length;
      store.totalDuration = newDuration;
      store._dataVersion++;
    });
  } else {
    // Paginated section: filter each loaded page
    for (const [pageIdx, page] of Object.entries(store._trackPages)) {
      const before = page.length;
      store._trackPages[pageIdx] = page.filter((t) => !idSet.has(t.id));
      removedCount += before - store._trackPages[pageIdx].length;
    }

    window.Alpine.disableEffectScheduling(() => {
      store.totalTracks = Math.max(0, store.totalTracks - removedCount);
      // Recompute duration from loaded pages
      let duration = 0;
      for (const page of Object.values(store._trackPages)) {
        for (const t of page) {
          duration += t.duration || 0;
        }
      }
      store.totalDuration = duration;
      store._dataVersion++;
    });
  }
  store._clearCache();

  // Remove from queue if present
  removeFromQueue(Alpine, idSet);
}
