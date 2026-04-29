/**
 * Watched Folders Utility
 *
 * Helper functions for prompting users to add parent directories
 * to watched folders when importing music via drag-and-drop or file picker.
 */
import { tauriInvoke } from '../api/shared.js';

/**
 * Extract unique parent directories from file/folder paths
 * @param {string[]} paths - Array of file or directory paths
 * @returns {string[]} Unique parent directory paths
 */
export function extractParentDirectories(paths) {
  if (!paths || paths.length === 0) {
    return [];
  }

  const parentDirs = new Set();

  for (const path of paths) {
    // Normalize path separators (handle both Unix and Windows)
    const normalizedPath = path.replace(/\\/g, '/');

    // Check if path looks like a file (has extension) or directory
    const lastSegment = normalizedPath.split('/').pop();
    const isLikelyFile = lastSegment && lastSegment.includes('.');

    if (isLikelyFile) {
      // Extract parent directory
      const lastSlashIndex = normalizedPath.lastIndexOf('/');
      if (lastSlashIndex > 0) {
        const parentDir = normalizedPath.substring(0, lastSlashIndex);
        parentDirs.add(parentDir);
      }
    } else {
      // It's a directory - use as-is
      parentDirs.add(normalizedPath);
    }
  }

  let dirs = Array.from(parentDirs);

  // Remove subdirectories when an ancestor is also in the set
  dirs = dirs.filter(
    (dir) => !dirs.some((other) => dir !== other && dir.startsWith(other + '/')),
  );

  // Collapse siblings: if 5+ directories share the same parent, use the parent instead
  const SIBLING_THRESHOLD = 5;
  const grouped = new Map();
  const ungrouped = [];

  for (const dir of dirs) {
    const lastSlash = dir.lastIndexOf('/');
    if (lastSlash > 0) {
      const parent = dir.substring(0, lastSlash);
      if (!grouped.has(parent)) {
        grouped.set(parent, []);
      }
      grouped.get(parent).push(dir);
    } else {
      ungrouped.push(dir);
    }
  }

  const collapsed = [];
  for (const [parent, children] of grouped) {
    if (children.length >= SIBLING_THRESHOLD) {
      collapsed.push(parent);
    } else {
      collapsed.push(...children);
    }
  }
  collapsed.push(...ungrouped);

  return collapsed;
}

/**
 * Get directories that aren't already in watched folders
 * @param {string[]} candidatePaths - Candidate directory paths
 * @returns {Promise<string[]>} Paths not yet watched
 */
export async function getNewWatchedFolderCandidates(candidatePaths) {
  if (!candidatePaths || candidatePaths.length === 0) {
    return [];
  }

  // Skip if not in Tauri environment
  if (!window.__TAURI__?.core?.invoke) {
    return [];
  }

  try {
    const watchedFolders = await tauriInvoke('watched_folders_list');

    // Extract paths from watched folders
    const watchedPaths = new Set(
      (watchedFolders || []).map((folder) => folder.path),
    );

    // Filter out already-watched directories
    return candidatePaths.filter((path) => !watchedPaths.has(path));
  } catch (error) {
    console.error('[watched-folders] Failed to fetch watched folders list:', error);
    // On error, return all candidates (better to show dialog than silently fail)
    return candidatePaths;
  }
}

/**
 * Add directories to watched folders via Tauri invoke.
 * @param {string[]} dirs - Directory paths to add
 * @returns {Promise<{added: number, failed: number, errors: Array}>}
 */
async function addWatchedFoldersBatch(dirs) {
  const results = { added: 0, failed: 0, errors: [] };

  for (const path of dirs) {
    try {
      await tauriInvoke('watched_folders_add', {
        request: {
          path,
          mode: 'continuous',
          cadence_minutes: 10,
          enabled: true,
        },
      });
      results.added++;
      console.log('[watched-folders] Added watched folder:', path);
    } catch (error) {
      results.failed++;
      results.errors.push({ path, error: error.message || String(error) });
      console.error('[watched-folders] Failed to add watched folder:', path, error);
    }
  }

  return results;
}

/**
 * Show a toast summarizing watched folder add results.
 */
function showWatchedFolderResultToast(results, totalCount) {
  const uiStore = window.Alpine?.store('ui');
  if (!uiStore) return;

  if (results.added > 0 && results.failed === 0) {
    uiStore.toast(
      `Added ${results.added} ${
        results.added === 1 ? 'directory' : 'directories'
      } to watched folders`,
      'success',
    );
  } else if (results.added > 0 && results.failed > 0) {
    uiStore.toast(
      `Added ${results.added} of ${totalCount} directories (${results.failed} failed)`,
      'warning',
    );
  } else if (results.failed > 0) {
    uiStore.toast(
      `Failed to add watched folders: ${results.errors[0]?.error || 'Unknown error'}`,
      'error',
    );
  }
}

/**
 * Prompt user to add directories to watched folders
 * @param {string[]} paths - Original paths from drag/drop or file picker
 * @returns {Promise<void>}
 */
export async function promptToAddWatchedFolders(paths) {
  if (!paths || paths.length === 0) return;
  if (!window.__TAURI__?.core?.invoke || !window.__TAURI__?.dialog?.confirm) return;

  try {
    const parentDirs = extractParentDirectories(paths);
    if (parentDirs.length === 0) return;

    const newDirs = await getNewWatchedFolderCandidates(parentDirs);
    if (newDirs.length === 0) {
      console.log('[watched-folders] All directories already watched, skipping prompt');
      return;
    }

    const dirList = newDirs.map((dir) => `\u2022 ${dir}`).join('\n');
    const message = `Add ${
      newDirs.length === 1 ? 'this directory' : 'these directories'
    } to watched folders?\n\nWatched folders are automatically scanned for new music.\n\n${dirList}`;

    const { confirm } = window.__TAURI__.dialog;
    const confirmed = await confirm(message, {
      title: 'Add to Watched Folders?',
      kind: 'info',
    });

    if (!confirmed) {
      console.log('[watched-folders] User declined to add watched folders');
      return;
    }

    const results = await addWatchedFoldersBatch(newDirs);
    showWatchedFolderResultToast(results, newDirs.length);
  } catch (error) {
    console.error('[watched-folders] Unexpected error in promptToAddWatchedFolders:', error);
  }
}
