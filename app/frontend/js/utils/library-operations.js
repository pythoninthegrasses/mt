/**
 * Library Operations — extracted heavy methods from createLibraryStore.
 *
 * Each function receives the store instance (and Alpine where needed)
 * so the store methods become thin one-line wrappers.  Moving the logic
 * here keeps cognitive complexity out of the store factory function.
 */

import { library } from '../api/library.js';
import { tauriInvoke } from '../api/shared.js';
import { promptToAddWatchedFolders } from '../utils/watched-folders.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute summary stats and update store state after a section fetch.
 * Shared between loadSection and backgroundRefreshSection.
 * Sets _sectionTracks for non-paginated sections.
 *
 * When `data` contains `total_tracks` and `total_duration` (from the
 * backend `library_get_section` response), those authoritative values
 * are used directly. Otherwise falls back to computing from the tracks
 * array for backward compatibility.
 */
export function applySectionData(store, section, tracks, data) {
  window.Alpine.disableEffectScheduling(() => {
    store._setSectionTracks(tracks);
    store.totalTracks = data?.total_tracks ?? data?.total ?? tracks.length;
    store.totalDuration = data?.total_duration ??
      tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    store.totalFileSize = data?.total_size ??
      tracks.reduce((sum, t) => sum + (t.file_size || 0), 0);
    store.localFileCount = data?.local_file_count ?? store.totalTracks;
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
 *
 * When `fetchFn` is omitted, uses `library.getSection({ section, ... })` —
 * the unified backend command that returns tracks + authoritative stats in
 * a single transaction.
 *
 * @param {object} store - Library store instance
 * @param {string} section - Section identifier (e.g. 'liked', 'recent')
 * @param {Function} fetchFn - Async function returning { tracks, total?, … }
 * @param {Object} [opts]
 * @param {Function} [opts.transform] - Transform raw tracks (default: store._filterByLibrary)
 * @param {Function} [opts.onSuccess] - Post-success callback receiving (data)
 * @param {string} [opts.logTag] - Log tag override (default: 'library')
 * @param {number} [opts.days] - Days lookback for recent/added sections
 * @returns {*} Return value from onSuccess, or undefined
 */
export async function loadSection(store, section, fetchFn, opts = {}) {
  const { transform, onSuccess, logTag = 'library', days } = opts;
  const cached = store._sectionCache[section];

  // Show cached summary stats if available (previous tracks stay visible during fetch)
  if (cached) {
    console.log(`[${logTag}]`, `load_${section}_with_cache_summary`, {
      totalTracks: cached.totalTracks,
    });
    store.totalTracks = cached.totalTracks;
    store.localFileCount = cached.localFileCount ?? cached.totalTracks;
    store.totalDuration = cached.totalDuration;
    store.totalFileSize = cached.totalFileSize ?? 0;
    store._lastLoadedSection = section;
  }

  store.loading = true;
  // DON'T clear tracks - keep showing previous data while loading
  try {
    // Prefer the unified backend command when no custom fetchFn is provided
    const useUnified = !fetchFn;
    let data;
    if (useUnified) {
      data = await library.getSection({
        section,
        days: days || null,
        limit: 1000,
      });
    } else {
      data = await fetchFn();
    }

    const rawTracks = data.tracks || [];
    // When using the unified backend command, tracks are already authoritative
    // — no need to filter against the "all" section (which may not be loaded).
    const tracks = transform
      ? transform(rawTracks, data)
      : useUnified
      ? rawTracks
      : store._filterByLibrary(rawTracks);

    if (useUnified) {
      // Use authoritative stats from backend
      applySectionData(store, section, tracks, data);
      store._updateCache(section, {
        total: data.total_tracks,
        totalDuration: data.total_duration,
        total_size: data.total_size,
      });
      if (data.revision !== undefined) {
        store._lastRevision = data.revision;
      }
    } else {
      applySectionData(store, section, tracks, { total: tracks.length });
      store._updateCache(section, { tracks, total: tracks.length });
    }

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
 *
 * When `fetchFn` is omitted, uses `library.getSection({ section, ... })` and
 * skips the update if the returned revision matches the last-seen revision.
 *
 * @param {object} store - Library store instance
 * @param {string} section - Section identifier
 * @param {Function} fetchFn - Async function returning { tracks, total?, … }
 * @param {Object} [opts]
 * @param {Function} [opts.transform] - Transform raw tracks (default: store._filterByLibrary)
 * @param {Function} [opts.onSuccess] - Post-success callback receiving (data)
 * @param {number} [opts.days] - Days lookback for recent/added sections
 */
export async function backgroundRefreshSection(store, section, fetchFn, opts = {}) {
  if (store._backgroundRefreshing) return;
  store._backgroundRefreshing = true;
  const { transform, onSuccess, days } = opts;

  try {
    const useUnified = !fetchFn;
    let data;
    if (useUnified) {
      data = await library.getSection({
        section,
        days: days || null,
        limit: 1000,
      });
      // Skip update if revision hasn't changed
      if (
        data.revision !== undefined &&
        store._lastRevision !== undefined &&
        data.revision === store._lastRevision
      ) {
        return;
      }
    } else {
      data = await fetchFn();
    }

    if (store._lastLoadedSection === section) {
      const rawTracks = data.tracks || [];
      const tracks = transform
        ? transform(rawTracks, data)
        : useUnified
        ? rawTracks
        : store._filterByLibrary(rawTracks);

      if (useUnified) {
        applySectionData(store, section, tracks, data);
        store._updateCache(section, {
          total: data.total_tracks,
          totalDuration: data.total_duration,
          total_size: data.total_size,
        });
        if (data.revision !== undefined) {
          store._lastRevision = data.revision;
        }
      } else {
        applySectionData(store, section, tracks, { total: tracks.length });
        store._updateCache(section, { tracks, total: tracks.length });
      }
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
 * Uses the unified `library_get_section` command to fetch count + first page
 * in a single transaction, ensuring consistent counts and track data.
 * Remaining pages load on demand via scroll.
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

  if (cached && !forceReload) {
    console.log('[library]', 'load_with_cache', {
      section: loadSection,
      totalTracks: cached.totalTracks,
      cacheAge: Math.round((Date.now() - cached.timestamp) / 1000) + 's',
    });
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

    // Reset pages and totalTracks together so the loading spinner shows
    // instead of empty placeholder rows (FOUC)
    store._resetPages();
    store.totalTracks = 0;
    store.localFileCount = 0;
    store.totalDuration = 0;
    store.totalFileSize = 0;

    // Attempt to rehydrate pages for this query from the LRU cache. Hit means
    // previously-fetched pages reappear instantly; the IPC call below still
    // runs to refresh totals and page 0 (which may overwrite the cached page 0
    // with equivalent fresh data — acceptable).
    const cacheHit = store._tryRestorePagesFromCache?.() === true;
    if (cacheHit) {
      console.log('[library]', 'page_cache_hit', {
        section: loadSection,
        pages: Object.keys(store._trackPages).length,
      });
    }

    // Fetch first page using unified endpoint (count + tracks in one transaction)
    const filterParams = store._getFilterParams();
    const sectionData = await library.getSection({
      section: 'all',
      search: filterParams.search || null,
      artist: filterParams.artist || null,
      album: filterParams.album || null,
      sort: filterParams.sort || null,
      order: filterParams.order || null,
      limit: store._pageSize,
      offset: 0,
      ignoreWords: filterParams.ignoreWords || null,
    });

    const _t1 = performance.now();

    if (store.currentSection !== loadSection || store.currentSection?.startsWith('playlist-')) {
      console.log('[library]', 'load_discarded', {
        startedIn: loadSection,
        currentSection: store.currentSection,
      });
      return;
    }

    // Store page 0 tracks from the unified response
    if (sectionData.tracks && sectionData.tracks.length > 0) {
      store._trackPages[0] = sectionData.tracks;
      // Stamp the cache key now that _trackPages is populated, so a later
      // _resetPages() can save these pages back into the LRU.
      if (!store._currentPageCacheKey) {
        store._currentPageCacheKey = store._buildPageCacheKey?.();
      }
    }

    window.Alpine.disableEffectScheduling(() => {
      store.totalTracks = sectionData.total_tracks;
      store.localFileCount = sectionData.local_file_count ?? sectionData.total_tracks;
      store.totalDuration = sectionData.total_duration;
      store.totalFileSize = sectionData.total_size ?? 0;
      store._lastLoadedSection = loadSection;
      store._dataVersion++;
    });

    if (sectionData.revision !== undefined) {
      store._lastRevision = sectionData.revision;
    }

    store._updateCache(loadSection, {
      total: sectionData.total_tracks,
      totalDuration: sectionData.total_duration,
      total_size: sectionData.total_size,
    });
    const _t2 = performance.now();

    window._perfLibLoad = {
      fetch_ms: Math.round(_t1 - _t0),
      process_ms: Math.round(_t2 - _t1),
      total_ms: Math.round(_t2 - _t0),
      page0_tracks: store._trackPages[0]?.length || 0,
      total_tracks: sectionData.total_tracks,
    };
    console.log('[perf] library.load breakdown:', window._perfLibLoad);
    console.log('[library]', 'load_complete', {
      page0Count: store._trackPages[0]?.length || 0,
      totalTracks: sectionData.total_tracks,
      section: loadSection,
    });
  } catch (error) {
    console.error('[library]', 'load_error', { error: error.message });
    store._resetPages();
    store.totalTracks = 0;
    store.localFileCount = 0;
    store.totalDuration = 0;
    store.totalFileSize = 0;
  } finally {
    store.loading = false;
  }
}

/**
 * Silently refresh the main library data in background without spinner.
 * Uses the unified `library_get_section` command. Skips the update if the
 * returned revision matches the last-seen revision.
 * @param {object} store - Library store instance
 * @param {string} section - Current section to refresh
 */
export async function backgroundRefreshLibrary(store, section) {
  if (store._backgroundRefreshing) return;
  store._backgroundRefreshing = true;

  try {
    console.log('[library] background refresh starting for:', section);

    const filterParams = store._getFilterParams();
    const sectionData = await library.getSection({
      section: 'all',
      search: filterParams.search || null,
      artist: filterParams.artist || null,
      album: filterParams.album || null,
      sort: filterParams.sort || null,
      order: filterParams.order || null,
      limit: store._pageSize,
      offset: 0,
      ignoreWords: filterParams.ignoreWords || null,
    });

    // Skip update if revision hasn't changed
    if (
      sectionData.revision !== undefined &&
      store._lastRevision !== undefined &&
      sectionData.revision === store._lastRevision
    ) {
      return;
    }

    if (store.currentSection === section) {
      // Preserve loaded pages so the user's scroll position survives a sync.
      // Only update page 0 (which we just fetched) and drop in-flight loads to
      // avoid stale-generation races. Other pages refetch on next access.
      // Do NOT call _resetPages() or bump _loadGeneration — that wipes the SWR
      // snapshot and causes the virtual scroll to snap back to the top.
      store._loadingPages = {};
      store._allPagesLoaded = false;
      if (sectionData.tracks && sectionData.tracks.length > 0) {
        store._trackPages[0] = sectionData.tracks;
      }

      window.Alpine.disableEffectScheduling(() => {
        store.totalTracks = sectionData.total_tracks;
        store.localFileCount = sectionData.local_file_count ?? sectionData.total_tracks;
        store.totalDuration = sectionData.total_duration;
        store.totalFileSize = sectionData.total_size ?? 0;
        store._dataVersion++;
      });

      if (sectionData.revision !== undefined) {
        store._lastRevision = sectionData.revision;
      }

      store._updateCache(section, {
        total: sectionData.total_tracks,
        totalDuration: sectionData.total_duration,
        total_size: sectionData.total_size,
      });

      console.log('[library] background refresh complete:', {
        section,
        totalTracks: sectionData.total_tracks,
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

    const paths = await tauriInvoke('open_add_music_dialog');

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
  // Original order is now managed by the backend
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

  // Mutating tracks invalidates every cached query bucket — they all
  // potentially contain stale copies of the deleted tracks.
  store._pageCache?.clear();

  const currentTracks = store.filteredTracks;

  // Fast path: clearing the entire library
  if (trackIds.length >= currentTracks.length) {
    window.Alpine.disableEffectScheduling(() => {
      store._resetPages();
      store._setSectionTracks([]);
      store.totalTracks = 0;
      store.localFileCount = 0;
      store.totalDuration = 0;
      store.totalFileSize = 0;
      store._dataVersion++;
    });
    store._clearCache();

    const queue = Alpine.store('queue');
    queue.items = [];
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
    const newFileSize = newTracks.reduce((sum, t) => sum + (t.file_size || 0), 0);

    window.Alpine.disableEffectScheduling(() => {
      store._setSectionTracks(newTracks);
      store.totalTracks = newTracks.length;
      store.localFileCount = newTracks.filter((t) => !store.isRemote(t)).length;
      store.totalDuration = newDuration;
      store.totalFileSize = newFileSize;
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
      store.localFileCount = Math.max(0, store.localFileCount - removedCount);
      // Recompute duration and file size from loaded pages
      let duration = 0;
      let fileSize = 0;
      for (const page of Object.values(store._trackPages)) {
        for (const t of page) {
          duration += t.duration || 0;
          fileSize += t.file_size || 0;
        }
      }
      store.totalDuration = duration;
      store.totalFileSize = fileSize;
      store._dataVersion++;
    });
  }
  store._clearCache();

  // Remove from queue if present
  removeFromQueue(Alpine, idSet);
}
