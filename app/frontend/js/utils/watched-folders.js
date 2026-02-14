/**
 * Utility functions for watched folder confirmation when adding files to the library.
 */

const AUDIO_EXTENSIONS = /\.(mp3|flac|m4a|ogg|wav|aac|wma|opus)$/i;

/**
 * Extract unique parent directories from a list of file/folder paths.
 * For files (audio extensions), uses the parent directory.
 * For directories (no audio extension), uses the path itself.
 * @param {string[]} paths
 * @returns {string[]} Unique parent directory paths
 */
export function extractParentDirectories(paths) {
  const dirs = new Set();
  for (const p of paths) {
    const lastSlash = p.lastIndexOf('/');
    if (lastSlash <= 0) continue;
    const basename = p.substring(lastSlash + 1);
    // For audio files, the immediate parent is the containing folder (e.g. artist/album dir)
    // For directories, it's the path itself
    const dir = AUDIO_EXTENSIONS.test(basename) ? p.substring(0, lastSlash) : p;
    dirs.add(dir);
    // Also include the grandparent (e.g. music root) as an option
    const parentSlash = dir.lastIndexOf('/');
    if (parentSlash > 0) {
      dirs.add(dir.substring(0, parentSlash));
    }
  }
  return Array.from(dirs);
}

/**
 * Classify directories as already-watched or new.
 * A directory is "already watched" if it matches or is a subdirectory of any watched folder.
 * @param {string[]} directories - Candidate directories
 * @param {Array<{path: string}>} watchedFolders - Existing watched folders
 * @returns {Array<{path: string, alreadyWatched: boolean}>}
 */
export function classifyDirectories(directories, watchedFolders) {
  const watchedPaths = watchedFolders.map((f) => f.path);
  return directories.map((dir) => ({
    path: dir,
    alreadyWatched: watchedPaths.some(
      (wp) => dir === wp || dir.startsWith(wp + '/'),
    ),
  }));
}

/**
 * Prompt the user to add parent directories of imported files to watched folders.
 * Skips silently if all directories are already watched.
 * @param {string[]} paths - File or directory paths that were added to the library
 */
export async function promptWatchedFolderConfirmation(paths) {
  if (!window.__TAURI__) return;

  try {
    const { invoke } = window.__TAURI__.core;
    const directories = extractParentDirectories(paths);
    if (directories.length === 0) return;

    const watchedFolders = await invoke('watched_folders_list');
    const classified = classifyDirectories(directories, watchedFolders);

    if (classified.every((d) => d.alreadyWatched)) return;

    const Alpine = window.Alpine;
    const ui = Alpine.store('ui');
    const selectedPaths = await ui.showWatchedFolderConfirm(classified);

    if (!selectedPaths || selectedPaths.length === 0) return;

    let added = 0;
    for (const path of selectedPaths) {
      try {
        await invoke('watched_folders_add', {
          request: { path, mode: 'continuous', cadence_minutes: 10, enabled: true },
        });
        added++;
      } catch (err) {
        console.warn('[watched-folders] Failed to add watched folder:', path, err);
      }
    }

    if (added > 0) {
      ui.toast(`Added ${added} folder${added === 1 ? '' : 's'} to watch list`, 'success');
      window.dispatchEvent(new CustomEvent('mt:watched-folders-updated'));
    }
  } catch (error) {
    console.error('[watched-folders] Confirmation prompt failed:', error);
  }
}
