import Alpine from 'alpinejs';
import persist from '@alpinejs/persist';
import intersect from '@alpinejs/intersect';
import focus from '@alpinejs/focus';
import { initStores } from './js/stores/index.js';
import { initComponents } from './js/components/index.js';
import { initKeyboardShortcuts } from './js/shortcuts.js';
import { formatBytes, formatDuration, formatTime } from './js/utils/formatting.js';
import { settings } from './js/services/settings.js';
import { handleFilesDrop, handleInternalTrackDrop } from './js/utils/tauri-drag-drop.js';
import { installGlobalErrorHandlers } from './js/utils/error-reporter.js';
import { initWebVitals } from './js/utils/web-vitals.js';
import './styles.css';

// Install global error handlers early so unhandled errors reach the backend log
installGlobalErrorHandlers();

// Report Core Web Vitals to backend structured logs
initWebVitals();

// Make formatting utilities globally available for HTML templates
window.formatTime = formatTime;
window.formatDuration = formatDuration;
window.formatBytes = formatBytes;

// Flags to track internal drag state and prevent click-after-drag
window._mtInternalDragActive = false;
window._mtDragJustEnded = false;
window._mtDraggedTrackIds = null;

window.handleFileDrop = async function (event) {
  console.log('[main] Browser drop event (Tauri handles via native events)');
};

async function initTauriDragDrop() {
  if (!window.__TAURI__) return;

  try {
    const { getCurrentWebview } = window.__TAURI__.webview;

    await getCurrentWebview().onDragDropEvent(async (event) => {
      const { type, paths, position } = event.payload;

      // Skip if internal HTML5 drag is active (e.g., dragging tracks to playlists)
      if (window._mtInternalDragActive) return;

      if (type === 'drop') {
        if ((!paths || paths.length === 0) && window._mtDraggedTrackIds && position) {
          await handleInternalTrackDrop(position);
          window._mtDraggedTrackIds = null;
        } else if (paths && paths.length > 0) {
          await handleFilesDrop(paths);
        }
      }
    });
  } catch (error) {
    console.error('[main] Failed to initialize Tauri drag-drop:', error);
  }
}

window.testDialog = async function () {
  console.log('[test] Testing dialog...');
  console.log(
    '[test] window.__TAURI__:',
    window.__TAURI__ ? Object.keys(window.__TAURI__) : 'undefined',
  );
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
  // Hardcoded background colors matching theme definitions.
  // Applied as inline style so the <html> background is correct
  // before the Tailwind CSS bundle computes theme variables.
  const themeBackgrounds = {
    'metro-teal': '#1e1e1e',
    'neon-love': '#1f1731',
    'dark': '#09090b',
    'light': '#ffffff',
  };

  if (!settings.initialized) {
    // Settings unavailable (e.g. browser mode) — apply system-preferred default
    const fallback = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.classList.add(fallback);
    document.documentElement.style.backgroundColor = themeBackgrounds[fallback];
    return;
  }

  const themePreset = settings.get('ui:themePreset', 'light');
  const theme = settings.get('ui:theme', 'system');

  document.documentElement.classList.remove('light', 'dark');
  delete document.documentElement.dataset.themePreset;

  if (themePreset === 'metro-teal' || themePreset === 'neon-love') {
    document.documentElement.classList.add('dark');
    document.documentElement.dataset.themePreset = themePreset;
    document.documentElement.style.backgroundColor = themeBackgrounds[themePreset];
  } else {
    const contentTheme = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.classList.add(contentTheme);
    document.documentElement.style.backgroundColor = themeBackgrounds[contentTheme];
  }
}

// Initialize application
async function initApp() {
  // Register Alpine plugins and expose globally (before any Alpine usage)
  Alpine.plugin(persist);
  Alpine.plugin(intersect);
  Alpine.plugin(focus);
  window.Alpine = Alpine;

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
    console.log(
      '[perf] control IPC (library_get_stats):',
      Math.round(t.controlIpc - ipcStart),
      'ms',
    );
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

  // Reveal the app after Alpine has initialized the DOM.
  // requestAnimationFrame fires after style recalculation and before paint,
  // ensuring Alpine-rendered DOM is fully styled before x-cloak is removed.
  // The window is already visible (shown early to avoid WebKit IPC throttling),
  // so rAF callbacks fire reliably.
  requestAnimationFrame(() => {
    console.log('[perf] revealApp at:', Math.round(performance.now() - t.start), 'ms');
    revealApp();
  });
}

// Make settings service globally available
window.settings = settings;

// Start the app
initApp();
