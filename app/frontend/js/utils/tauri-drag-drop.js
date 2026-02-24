/**
 * Tauri Drag-and-Drop Handlers
 *
 * Extracted from initTauriDragDrop in main.js to reduce cyclomatic complexity.
 * Handles two distinct drop scenarios:
 * 1. Internal track-to-playlist drops (Tauri intercepts HTML5 drag events)
 * 2. External file drops into the library
 */

import api from '../api.js';
import { promptToAddWatchedFolders } from './watched-folders.js';

/**
 * Handle an internal track drag dropped onto a playlist sidebar item.
 * Tauri intercepts HTML5 drag events, so we receive them as native
 * drag-drop events with empty paths but valid position coordinates.
 *
 * @param {number[]} position - [x, y] drop coordinates (physical pixels)
 * @returns {Promise<boolean>} true if the drop was handled (landed on a playlist)
 */
export async function handleInternalTrackDrop(position) {
  const x = position.x / window.devicePixelRatio;
  const y = position.y / window.devicePixelRatio;
  const element = document.elementFromPoint(x, y);
  const playlistButton = element?.closest('[data-testid^="sidebar-playlist-"]');

  if (!playlistButton) {
    return false;
  }

  const testId = playlistButton.dataset.testid;
  const playlistId = parseInt(testId.replace('sidebar-playlist-', ''), 10);
  const playlistName = playlistButton.querySelector('span')?.textContent || 'playlist';

  try {
    const result = await api.playlists.addTracks(playlistId, window._mtDraggedTrackIds);
    const ui = window.Alpine.store('ui');

    if (result.added > 0) {
      ui.toast(
        `Added ${result.added} track${result.added > 1 ? 's' : ''} to "${playlistName}"`,
        'success',
      );
    } else {
      ui.toast(
        `Track${window._mtDraggedTrackIds.length > 1 ? 's' : ''} already in "${playlistName}"`,
        'info',
      );
    }
    window.dispatchEvent(new CustomEvent('mt:playlists-updated'));
  } catch (error) {
    console.error('[main] Failed to add tracks to playlist:', error);
    window.Alpine.store('ui').toast('Failed to add tracks to playlist', 'error');
  }

  return true;
}

/**
 * Handle external files dropped onto the application window.
 * Scans the dropped paths into the library and prompts to add
 * parent directories as watched folders.
 *
 * @param {string[]} paths - File or directory paths from the native drop event
 */
export async function handleFilesDrop(paths) {
  try {
    const result = await window.Alpine.store('library').scan(paths);
    const ui = window.Alpine.store('ui');

    if (result.added > 0) {
      ui.toast(`Added ${result.added} track${result.added === 1 ? '' : 's'} to library`, 'success');
    } else if (result.skipped > 0) {
      ui.toast(
        `All ${result.skipped} track${result.skipped === 1 ? '' : 's'} already in library`,
        'info',
      );
    } else {
      ui.toast('No audio files found', 'info');
    }

    try {
      await promptToAddWatchedFolders(paths);
    } catch (error) {
      console.error('[main] Failed to add watched folders:', error);
    }
  } catch (error) {
    console.error('[main] Failed to process dropped files:', error);
    window.Alpine.store('ui').toast('Failed to add files', 'error');
  }
}
