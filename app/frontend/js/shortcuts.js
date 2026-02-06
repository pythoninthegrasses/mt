/**
 * Global keyboard shortcuts for the music player.
 *
 * Handles playback controls, volume, navigation, and context-aware
 * shortcuts. Component-level shortcuts (Cmd+A, Enter, Delete in library)
 * remain in their respective components (library-browser.js).
 */

const VOLUME_STEP = 5;
const SEEK_STEP_MS = 5000;

/**
 * Check if the event target is an input/textarea where shortcuts should be suppressed.
 */
function isTypingInInput(event) {
  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (event.target.isContentEditable) return true;
  return false;
}

/**
 * Check if the current view is Now Playing.
 */
function isNowPlayingView() {
  return Alpine.store('ui').view === 'nowPlaying';
}

/**
 * Check if the current view is library or a playlist (not Now Playing, not settings).
 */
function isLibraryOrPlaylistView() {
  const view = Alpine.store('ui').view;
  return view === 'library';
}

/**
 * Detect macOS for display purposes.
 */
export function isMac() {
  return navigator.platform?.startsWith('Mac') || navigator.userAgent?.includes('Mac');
}

/**
 * Return the platform modifier label (Cmd on macOS, Ctrl elsewhere).
 */
export function modLabel() {
  return isMac() ? '\u2318' : 'Ctrl';
}

/**
 * All shortcut definitions used by both the handler and the settings display.
 * Context-aware shortcuts include a `context` field.
 */
export const SHORTCUT_DEFINITIONS = [
  { key: 'Space', label: 'Space', action: 'Play / Pause' },
  { key: 'ArrowRight', label: '\u2192', action: 'Next track' },
  { key: 'mod+ArrowRight', label: '{mod}+\u2192', action: 'Seek forward 5s' },
  { key: 'ArrowLeft', label: '\u2190', action: 'Previous track' },
  { key: 'mod+ArrowLeft', label: '{mod}+\u2190', action: 'Seek back 5s' },
  { key: 'ArrowUp', label: '\u2191', action: 'Volume up' },
  { key: 'ArrowDown', label: '\u2193', action: 'Volume down' },
  { key: 'KeyM', label: 'M', action: 'Mute / Unmute' },
  { key: 'KeyL', label: 'L', action: 'Cycle loop mode' },
  { key: 'KeyS', label: 'S', action: 'Toggle shuffle' },
  { key: 'mod+KeyF', label: '{mod}+F', action: 'Focus search' },
  { key: 'Escape', label: 'Esc', action: 'Clear search / Close dialogs' },
  { key: 'mod+Comma', label: '{mod}+,', action: 'Toggle settings' },
  {
    key: 'mod+KeyD',
    label: '{mod}+D',
    action: 'Queue selected next',
    context: 'Library / Playlist only',
  },
  {
    key: 'mod+KeyS',
    label: '{mod}+S',
    action: 'Stop after current track',
    context: 'Library / Playlist only',
  },
  {
    key: 'Delete',
    label: 'Delete / \u232B',
    action: 'Delete selected playlist',
    context: 'Sidebar playlist',
  },
];

/**
 * Initialize all global keyboard shortcuts.
 * Call once after Alpine stores are ready.
 */
export function initKeyboardShortcuts() {
  document.addEventListener('keydown', handleKeydown);
}

function handleKeydown(event) {
  const player = Alpine.store('player');
  const queue = Alpine.store('queue');
  const ui = Alpine.store('ui');
  const hasMod = event.metaKey || event.ctrlKey;

  // --- Modifier shortcuts (always active, even in inputs) ---

  // Cmd/Ctrl+, : Toggle settings
  if (hasMod && event.key === ',') {
    event.preventDefault();
    ui.toggleSettings();
    return;
  }

  // Cmd/Ctrl+F : Focus search
  if (hasMod && event.code === 'KeyF') {
    event.preventDefault();
    const searchInput = document.querySelector('[data-testid="sidebar-search"]');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
    return;
  }

  // Cmd/Ctrl+D : Queue selected track next (library/playlist only)
  // Dispatches a custom event handled by the library browser component,
  // ensuring the method runs in the correct Alpine.js scope.
  if (hasMod && event.code === 'KeyD') {
    event.preventDefault();
    if (isLibraryOrPlaylistView()) {
      window.dispatchEvent(new CustomEvent('mt:queue-next-shortcut'));
    }
    return;
  }

  // Cmd/Ctrl+S : Stop after current track (library/playlist only)
  if (hasMod && event.code === 'KeyS') {
    event.preventDefault();
    if (isLibraryOrPlaylistView() && !isNowPlayingView()) {
      queue.stopAfterCurrent = !queue.stopAfterCurrent;
      const state = queue.stopAfterCurrent ? 'enabled' : 'disabled';
      ui.toast(`Stop after current track ${state}`, 'info');
    }
    return;
  }

  // --- Non-modifier shortcuts: suppress when typing in inputs ---
  if (isTypingInInput(event)) return;

  switch (event.code) {
    // Space: Play/Pause
    case 'Space':
      event.preventDefault();
      player.togglePlay();
      break;

    // Arrow Right: Next track / Seek forward
    case 'ArrowRight':
      event.preventDefault();
      if (hasMod) {
        player.seek(player.currentTime + SEEK_STEP_MS);
      } else {
        player.next();
      }
      break;

    // Arrow Left: Previous track / Seek back
    case 'ArrowLeft':
      event.preventDefault();
      if (hasMod) {
        player.seek(Math.max(0, player.currentTime - SEEK_STEP_MS));
      } else {
        player.previous();
      }
      break;

    // Arrow Up: Volume up
    case 'ArrowUp':
      event.preventDefault();
      player.setVolume(player.volume + VOLUME_STEP);
      break;

    // Arrow Down: Volume down
    case 'ArrowDown':
      event.preventDefault();
      player.setVolume(player.volume - VOLUME_STEP);
      break;

    // M: Mute/Unmute
    case 'KeyM':
      player.toggleMute();
      break;

    // L: Cycle loop mode
    case 'KeyL':
      queue.cycleLoop();
      break;

    // S: Toggle shuffle (without modifier)
    case 'KeyS':
      queue.toggleShuffle();
      break;

    // Escape: Clear search, close settings, close dialogs
    case 'Escape':
      if (ui.view === 'settings') {
        event.preventDefault();
        ui.toggleSettings();
      } else if (ui.modal) {
        event.preventDefault();
        ui.closeModal();
      } else {
        // Clear search if active
        const library = Alpine.store('library');
        if (library.searchQuery) {
          library.searchQuery = '';
          library.search('');
        }
      }
      break;

    default:
      break;
  }
}
