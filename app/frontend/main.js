import Alpine from 'alpinejs';
import persist from '@alpinejs/persist';
import intersect from '@alpinejs/intersect';
import focus from '@alpinejs/focus';
import { initStores } from './js/stores/index.js';
import { initComponents } from './js/components/index.js';
import { initKeyboardShortcuts } from './js/shortcuts.js';
import api from './js/api.js';
import { formatTime, formatDuration, formatBytes } from './js/utils/formatting.js';
import { settings } from './js/services/settings.js';
import { promptToAddWatchedFolders } from './js/utils/watched-folders.js';
import { installGlobalErrorHandlers } from './js/utils/error-reporter.js';
import { initWebVitals } from './js/utils/web-vitals.js';
import './styles.css';

// Install global error handlers early so unhandled errors reach the backend log
installGlobalErrorHandlers();

// Report Core Web Vitals to backend structured logs
initWebVitals();

// Register Alpine plugins
Alpine.plugin(persist);
Alpine.plugin(intersect);
Alpine.plugin(focus);

window.Alpine = Alpine;

// Make formatting utilities globally available for HTML templates
window.formatTime = formatTime;
window.formatDuration = formatDuration;
window.formatBytes = formatBytes;

// Flags to track internal drag state and prevent click-after-drag
window._mtInternalDragActive = false;
window._mtDragJustEnded = false;
window._mtDraggedTrackIds = null;

window.handleFileDrop = async function(event) {
  console.log('[main] Browser drop event (Tauri handles via native events)');
};

async function initTauriDragDrop() {
  if (!window.__TAURI__) {
    console.log('[main] No Tauri environment detected');
    return;
  }
  
  console.log('[main] Tauri object keys:', Object.keys(window.__TAURI__));
  
  try {
    const { getCurrentWebview } = window.__TAURI__.webview;
    
    await getCurrentWebview().onDragDropEvent(async (event) => {
      const { type, paths, position } = event.payload;
      
      // Skip if internal HTML5 drag is active (e.g., dragging tracks to playlists)
      if (window._mtInternalDragActive) {
        console.log('[main] Skipping Tauri drag event - internal drag active:', type);
        return;
      }
      
      console.log('[main] Drag-drop event:', event);
      
      if (type === 'over') {
        console.log('[main] Drag over:', position);
      } else if (type === 'drop') {
        console.log('[main] Files dropped:', paths);
        
        // Handle internal track drag to playlist (Tauri intercepts HTML5 drop)
        if ((!paths || paths.length === 0) && window._mtDraggedTrackIds && position) {
          const x = position.x / window.devicePixelRatio;
          const y = position.y / window.devicePixelRatio;
          const element = document.elementFromPoint(x, y);
          const playlistButton = element?.closest('[data-testid^="sidebar-playlist-"]');
          
          if (playlistButton) {
            const testId = playlistButton.dataset.testid;
            const playlistId = parseInt(testId.replace('sidebar-playlist-', ''), 10);
            const playlistName = playlistButton.querySelector('span')?.textContent || 'playlist';
            console.log('[main] Internal drop on playlist:', playlistId, playlistName, 'tracks:', window._mtDraggedTrackIds);
            
            try {
              const result = await api.playlists.addTracks(playlistId, window._mtDraggedTrackIds);
              const ui = Alpine.store('ui');
              
              if (result.added > 0) {
                ui.toast(`Added ${result.added} track${result.added > 1 ? 's' : ''} to "${playlistName}"`, 'success');
              } else {
                ui.toast(`Track${window._mtDraggedTrackIds.length > 1 ? 's' : ''} already in "${playlistName}"`, 'info');
              }
              window.dispatchEvent(new CustomEvent('mt:playlists-updated'));
            } catch (error) {
              console.error('[main] Failed to add tracks to playlist:', error);
              Alpine.store('ui').toast('Failed to add tracks to playlist', 'error');
            }
            window._mtDraggedTrackIds = null;
            return;
          }
        }
        
        if (paths && paths.length > 0) {
          try {
            const result = await Alpine.store('library').scan(paths);
            const ui = Alpine.store('ui');
            if (result.added > 0) {
              ui.toast(`Added ${result.added} track${result.added === 1 ? '' : 's'} to library`, 'success');
            } else if (result.skipped > 0) {
              ui.toast(`All ${result.skipped} track${result.skipped === 1 ? '' : 's'} already in library`, 'info');
            } else {
              ui.toast('No audio files found', 'info');
            }

            // Prompt to add parent directories to watched folders
            try {
              await promptToAddWatchedFolders(paths);
            } catch (error) {
              console.error('[main] Failed to add watched folders:', error);
              // Don't block - scan already succeeded
            }
          } catch (error) {
            console.error('[main] Failed to process dropped files:', error);
            Alpine.store('ui').toast('Failed to add files', 'error');
          }
        }
      } else if (type === 'cancel') {
        console.log('[main] Drag cancelled');
      }
    });
    
    console.log('[main] Tauri drag-drop listener initialized');
  } catch (error) {
    console.error('[main] Failed to initialize Tauri drag-drop:', error);
  }
}

window.testDialog = async function() {
  console.log('[test] Testing dialog...');
  console.log('[test] window.__TAURI__:', window.__TAURI__ ? Object.keys(window.__TAURI__) : 'undefined');
  console.log('[test] window.__TAURI__.dialog:', window.__TAURI__?.dialog);
  
  if (window.__TAURI__?.dialog?.open) {
    try {
      const result = await window.__TAURI__.dialog.open({ directory: true, multiple: true });
      console.log('[test] Dialog result:', result);
    } catch (e) {
      console.error('[test] Dialog error:', e);
    }
  } else {
    console.error('[test] dialog.open not available');
  }
};

function initGlobalKeyboardShortcuts() {
  initKeyboardShortcuts();
}

async function initTitlebarDrag() {
  if (!window.__TAURI__) return;
  
  const dragRegion = document.querySelector('[data-tauri-drag-region]');
  if (!dragRegion) return;
  
  try {
    const { getCurrentWindow } = window.__TAURI__.window;
    const appWindow = getCurrentWindow();
    
    dragRegion.addEventListener('mousedown', async (e) => {
      if (e.buttons === 1 && !e.target.closest('button, input, a')) {
        e.preventDefault();
        e.detail === 2 ? await appWindow.toggleMaximize() : await appWindow.startDragging();
      }
    });
  } catch (error) {
    console.error('[main] Failed to initialize titlebar drag:', error);
  }
}

/**
 * Reveal the UI content.
 * Window is already visible (shown early in initApp to avoid WebKit throttling).
 * This just removes x-cloak so Alpine-rendered content becomes visible.
 */
function revealApp() {
  document.body.removeAttribute('x-cloak');
  console.log('[main] App ready, UI revealed');
}

/**
 * Apply theme classes to <html> before Alpine starts.
 * This prevents a flash of incorrect styling (e.g., sidebar showing light-mode
 * colors when metro-teal is selected) by ensuring CSS variables are set before
 * the first visible paint.
 */
function applyInitialTheme() {
  if (!settings.initialized) return;

  const themePreset = settings.get('ui:themePreset', 'light');
  const theme = settings.get('ui:theme', 'system');

  document.documentElement.classList.remove('light', 'dark');
  delete document.documentElement.dataset.themePreset;

  if (themePreset === 'metro-teal') {
    document.documentElement.classList.add('dark');
    document.documentElement.dataset.themePreset = 'metro-teal';
  } else {
    const contentTheme = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.classList.add(contentTheme);
  }
}

// Initialize application
async function initApp() {
  const t = { start: performance.now() };
  window._perfTimings = t;

  // Initialize settings service first (loads settings from backend)
  if (window.__TAURI__) {
    try {
      await settings.init();
      t.settings = performance.now();
      console.log('[perf] settings.init:', Math.round(t.settings - t.start), 'ms');
    } catch (error) {
      console.error('[main] Failed to initialize settings:', error);
    }
  } else {
    console.log('[main] Running in browser mode, settings service disabled');
  }

  // Pre-apply theme to <html> before Alpine starts to prevent flash of incorrect styling.
  // Without this, the theme is only applied when Alpine's ui store init() runs,
  // which can cause the sidebar to briefly render with wrong theme colors.
  applyInitialTheme();

  // Show window early so WebKit doesn't throttle IPC callbacks.
  // The body still has x-cloak (hiding content), but the window being visible
  // prevents the WebView from deprioritizing async callback execution.
  if (window.__TAURI__) {
    try {
      const { getCurrentWindow } = window.__TAURI__.window;
      await getCurrentWindow().show();
      t.windowShow = performance.now();
      console.log('[perf] window.show:', Math.round(t.windowShow - t.start), 'ms');
    } catch (error) {
      console.error('[main] Failed to show window early:', error);
    }
  }

  // Set platform attribute for Linux-specific CSS (hide macOS overlay titlebar gap)
  if (navigator.platform?.startsWith('Linux')) {
    document.documentElement.dataset.platform = 'linux';
  }

  // Disable the default browser/webview context menu globally
  // App-specific context menus (tracks, headers, playlists) handle their own rendering
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Control IPC measurement — small call to verify IPC latency at this point
  if (window.__TAURI__) {
    const ipcStart = performance.now();
    await window.__TAURI__.core.invoke('library_get_stats');
    t.controlIpc = performance.now();
    console.log('[perf] control IPC (library_get_stats):', Math.round(t.controlIpc - ipcStart), 'ms');
  }

  // Initialize stores and components
  t.preStores = performance.now();
  initStores(Alpine);
  t.stores = performance.now();
  console.log('[perf] initStores:', Math.round(t.stores - t.preStores), 'ms');

  initComponents(Alpine);
  t.components = performance.now();
  console.log('[perf] initComponents:', Math.round(t.components - t.stores), 'ms');

  initTauriDragDrop();
  initGlobalKeyboardShortcuts();
  initTitlebarDrag();

  // Start Alpine
  t.preAlpine = performance.now();
  Alpine.start();
  t.alpine = performance.now();
  console.log('[perf] Alpine.start():', Math.round(t.alpine - t.preAlpine), 'ms');
  console.log('[perf] total initApp (sync):', Math.round(t.alpine - t.start), 'ms');
  console.log('[main] Test dialog with: testDialog()');

  // Reveal the app after Alpine has initialized the DOM
  // Note: We use setTimeout instead of requestAnimationFrame because
  // RAF callbacks don't fire when the window is hidden (visible: false)
  setTimeout(() => {
    console.log('[perf] revealApp at:', Math.round(performance.now() - t.start), 'ms');
    revealApp();
  }, 0);
}

// Make settings service globally available
window.settings = settings;

// Start the app
initApp();
