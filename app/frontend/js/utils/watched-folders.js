/**
 * Watched Folders Utility
 *
 * Helper functions for prompting users to add parent directories
 * to watched folders when importing music via drag-and-drop or file picker.
 */

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
    const { invoke } = window.__TAURI__.core;
    const watchedFolders = await invoke('watched_folders_list');

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
 * Prompt user to add directories to watched folders
 * @param {string[]} paths - Original paths from drag/drop or file picker
 * @returns {Promise<void>}
 */
export async function promptToAddWatchedFolders(paths) {
  // Skip if no paths provided
  if (!paths || paths.length === 0) {
    return;
  }

  // Skip if not in Tauri environment
  if (!window.__TAURI__?.core?.invoke || !window.__TAURI__?.dialog?.confirm) {
    return;
  }

  try {
    // Extract parent directories from paths
    const parentDirs = extractParentDirectories(paths);

    if (parentDirs.length === 0) {
      return;
    }

    // Filter out already-watched directories
    const newDirs = await getNewWatchedFolderCandidates(parentDirs);

    if (newDirs.length === 0) {
      console.log('[watched-folders] All directories already watched, skipping prompt');
      return;
    }

    // Build confirmation message
    const dirList = newDirs.map((dir) => `• ${dir}`).join('\n');
    const message = `Add ${
      newDirs.length === 1 ? 'this directory' : 'these directories'
    } to watched folders?\n\nWatched folders are automatically scanned for new music.\n\n${dirList}`;

    // Show confirmation dialog
    const { confirm } = window.__TAURI__.dialog;
    const confirmed = await confirm(message, {
      title: 'Add to Watched Folders?',
      kind: 'info',
    });

    if (!confirmed) {
      console.log('[watched-folders] User declined to add watched folders');
      return;
    }

    // Add each directory to watched folders
    const { invoke } = window.__TAURI__.core;
    const results = {
      added: 0,
      failed: 0,
      errors: [],
    };

    for (const path of newDirs) {
      try {
        await invoke('watched_folders_add', {
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

    // Show result toast
    const uiStore = window.Alpine?.store('ui');
    if (uiStore) {
      if (results.added > 0 && results.failed === 0) {
        uiStore.toast(
          `Added ${results.added} ${
            results.added === 1 ? 'directory' : 'directories'
          } to watched folders`,
          'success',
        );
      } else if (results.added > 0 && results.failed > 0) {
        uiStore.toast(
          `Added ${results.added} of ${newDirs.length} directories (${results.failed} failed)`,
          'warning',
        );
      } else if (results.failed > 0) {
        uiStore.toast(
          `Failed to add watched folders: ${results.errors[0]?.error || 'Unknown error'}`,
          'error',
        );
      }
    }
  } catch (error) {
    console.error('[watched-folders] Unexpected error in promptToAddWatchedFolders:', error);
    // Don't throw - we don't want to block the scan success
  }
}
