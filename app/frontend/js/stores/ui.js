import { api } from '../api.js';

export function createUIStore(Alpine) {
  Alpine.store('ui', {
    view: 'library',
    _previousView: 'library',

    // Settings (backed by Rust settings store)
    sidebarOpen: true,
    sidebarWidth: 250,
    libraryViewMode: 'list',
    theme: 'system',
    themePreset: 'light',
    settingsSection: 'general',
    sortIgnoreWords: true,
    sortIgnoreWordsList: 'the, le, la, los, a',

    modal: null,
    contextMenu: null,
    toasts: [],
    keyboardShortcutsEnabled: true,
    globalLoading: false,
    loadingMessage: '',

    init() {
      this._initSettings();
      this._migrateOldStorage();
      this.applyThemePreset();

      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.themePreset === 'light' && this.theme === 'system') {
          this.applyThemePreset();
        }
      });
    },

    /**
     * Initialize settings from backend and setup watchers.
     * Loads persisted settings from Rust settings store and syncs changes.
     */
    _initSettings() {
      if (!window.settings || !window.settings.initialized) {
        console.log('[ui] Settings service not available, using defaults');
        return;
      }

      // Load settings from backend
      this.sidebarOpen = window.settings.get('ui:sidebarOpen', true);
      this.sidebarWidth = window.settings.get('ui:sidebarWidth', 250);
      this.libraryViewMode = window.settings.get('ui:libraryViewMode', 'list');
      this.theme = window.settings.get('ui:theme', 'system');
      this.themePreset = window.settings.get('ui:themePreset', 'light');
      this.settingsSection = window.settings.get('ui:settingsSection', 'general');
      this.sortIgnoreWords = window.settings.get('ui:sortIgnoreWords', true);
      this.sortIgnoreWordsList = window.settings.get(
        'ui:sortIgnoreWordsList',
        'the, le, la, los, a',
      );

      console.log('[ui] Loaded settings from backend');

      // Note: Watchers for syncing to backend are set up after store creation
      // using Alpine.effect() (see bottom of createUIStore function)
    },

    _migrateOldStorage() {
      const oldData = localStorage.getItem('mt:ui');
      if (oldData) {
        try {
          const data = JSON.parse(oldData);
          if (data.sidebarOpen !== undefined) this.sidebarOpen = data.sidebarOpen;
          if (data.sidebarWidth !== undefined) this.sidebarWidth = data.sidebarWidth;
          if (data.libraryViewMode !== undefined) this.libraryViewMode = data.libraryViewMode;
          if (data.theme !== undefined) this.theme = data.theme;
          localStorage.removeItem('mt:ui');
        } catch (_e) {
          localStorage.removeItem('mt:ui');
        }
      }
    },

    setView(view) {
      const validViews = ['library', 'queue', 'nowPlaying', 'settings'];
      if (validViews.includes(view) && view !== this.view) {
        console.log('[navigation]', 'switch_view', {
          previousView: this.view,
          newView: view,
        });

        if (this.view !== 'settings') {
          this._previousView = this.view;
        }
        this.view = view;
      }
    },

    toggleSettings() {
      const newView = this.view === 'settings' ? (this._previousView || 'library') : 'settings';

      console.log('[navigation]', 'toggle_settings', {
        previousView: this.view,
        newView,
      });

      if (this.view === 'settings') {
        this.view = this._previousView || 'library';
      } else {
        this._previousView = this.view;
        this.view = 'settings';
      }
    },

    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen;
    },

    setSidebarWidth(width) {
      this.sidebarWidth = Math.max(180, Math.min(400, width));
    },

    setLibraryViewMode(mode) {
      if (['list', 'grid', 'compact'].includes(mode)) {
        this.libraryViewMode = mode;
      }
    },

    setTheme(theme) {
      if (['light', 'dark', 'system'].includes(theme)) {
        console.log('[settings]', 'set_theme', {
          previousTheme: this.theme,
          newTheme: theme,
        });

        this.theme = theme;
        this.applyTheme();
      }
    },

    setThemePreset(preset) {
      if (['light', 'metro-teal'].includes(preset)) {
        console.log('[settings]', 'set_theme_preset', {
          previousPreset: this.themePreset,
          newPreset: preset,
        });

        this.themePreset = preset;
        this.applyThemePreset();
      }
    },

    setSettingsSection(section) {
      if (
        ['general', 'library', 'appearance', 'shortcuts', 'sorting', 'advanced', 'lastfm'].includes(
          section,
        )
      ) {
        console.log('[settings]', 'navigate_section', {
          previousSection: this.settingsSection,
          newSection: section,
        });

        this.settingsSection = section;
      }
    },

    applyThemePreset() {
      document.documentElement.classList.remove('light', 'dark');
      delete document.documentElement.dataset.themePreset;

      let titleBarTheme;
      let contentTheme;

      if (this.themePreset === 'metro-teal') {
        document.documentElement.classList.add('dark');
        document.documentElement.dataset.themePreset = 'metro-teal';
        titleBarTheme = 'dark';
      } else {
        titleBarTheme = 'light';
        contentTheme = this.theme === 'system'
          ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : this.theme;
        document.documentElement.classList.add(contentTheme);
      }

      this._applyTauriWindowTheme(titleBarTheme);
    },

    async _applyTauriWindowTheme(theme) {
      if (!window.__TAURI__) return;

      try {
        const tauriWindow = window.__TAURI__.window;
        if (!tauriWindow?.getCurrentWindow) {
          console.warn('[ui] Tauri window API not available');
          return;
        }
        const win = tauriWindow.getCurrentWindow();
        await win.setTheme(theme === 'dark' ? 'dark' : 'light');
        console.log('[ui] Set Tauri window theme to:', theme);
      } catch (e) {
        console.warn('[ui] Failed to set Tauri window theme:', e);
      }
    },

    applyTheme() {
      this.applyThemePreset();
    },

    get effectiveTheme() {
      if (this.themePreset === 'metro-teal') {
        return 'dark';
      }
      if (this.theme === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return this.theme;
    },

    /**
     * Open modal
     * @param {string} type - Modal type
     * @param {any} data - Modal data
     */
    openModal(type, data = null) {
      this.modal = { type, data };
    },

    /**
     * Close modal
     */
    closeModal() {
      this.modal = null;
    },

    /**
     * Show context menu
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {Array} items - Menu items
     * @param {any} data - Associated data
     */
    showContextMenu(x, y, items, data = null) {
      this.contextMenu = { x, y, items, data };
    },

    /**
     * Hide context menu
     */
    hideContextMenu() {
      this.contextMenu = null;
    },

    /**
     * Show toast notification
     * @param {string} message - Toast message
     * @param {string} type - 'info', 'success', 'warning', 'error'
     * @param {number} duration - Duration in ms (0 = persistent)
     */
    toast(message, type = 'info', duration = 3000) {
      const id = Date.now();
      this.toasts.push({ id, message, type });

      if (duration > 0) {
        setTimeout(() => {
          this.dismissToast(id);
        }, duration);
      }

      return id;
    },

    /**
     * Dismiss toast by ID
     * @param {number} id - Toast ID
     */
    dismissToast(id) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },

    /**
     * Show global loading overlay
     * @param {string} message - Loading message
     */
    showLoading(message = 'Loading...') {
      this.globalLoading = true;
      this.loadingMessage = message;
    },

    /**
     * Hide global loading overlay
     */
    hideLoading() {
      this.globalLoading = false;
      this.loadingMessage = '';
    },

    /**
     * Check if current view is active
     * @param {string} view - View to check
     */
    isView(view) {
      return this.view === view;
    },

    missingTrackModal: null,
    _missingTrackResolve: null,

    missingTrackPopover: null,

    openMissingTrackPopover(track, event) {
      const rect = event.target.getBoundingClientRect();
      const popoverWidth = 320;
      const popoverHeight = 180;

      let x = rect.right + 8;
      let y = rect.top - 10;

      if (x + popoverWidth > window.innerWidth) {
        x = rect.left - popoverWidth - 8;
      }
      if (y + popoverHeight > window.innerHeight) {
        y = window.innerHeight - popoverHeight - 10;
      }
      if (y < 10) {
        y = 10;
      }

      this.missingTrackPopover = {
        track,
        filepath: track.filepath || track.path || 'Unknown path',
        lastSeenAt: track.last_seen_at,
        x,
        y,
      };
    },

    closeMissingTrackPopover() {
      this.missingTrackPopover = null;
    },

    async handlePopoverLocate() {
      if (!this.missingTrackPopover || !window.__TAURI__) {
        this.closeMissingTrackPopover();
        return;
      }

      try {
        const { open } = window.__TAURI__.dialog;
        // Default to the directory of the original file path
        const originalPath = this.missingTrackPopover.filepath;
        const defaultDir = originalPath
          ? originalPath.substring(0, originalPath.lastIndexOf('/'))
          : undefined;

        const selected = await open({
          multiple: false,
          defaultPath: defaultDir,
          filters: [
            {
              name: 'Audio Files',
              extensions: ['mp3', 'flac', 'ogg', 'm4a', 'wav', 'aac', 'wma', 'opus'],
            },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (selected) {
          const trackId = this.missingTrackPopover.track.id;
          await api.library.locate(trackId, selected);

          this.missingTrackPopover.track.missing = false;
          this.missingTrackPopover.track.filepath = selected;
          this.missingTrackPopover.track.path = selected;

          this.toast('File located successfully', 'success');
          this.closeMissingTrackPopover();
        }
      } catch (error) {
        console.error('[ui] Failed to locate file:', error);
        this.toast('Failed to locate file: ' + error.message, 'error');
      }
    },

    handlePopoverIgnore() {
      this.closeMissingTrackPopover();
    },

    showMissingTrackModal(track) {
      return new Promise((resolve) => {
        this._missingTrackResolve = resolve;
        this.missingTrackModal = {
          track,
          filepath: track.filepath || track.path,
          lastSeenAt: track.last_seen_at,
        };
      });
    },

    async handleLocateFile() {
      if (!this.missingTrackModal || !window.__TAURI__) {
        this.closeMissingTrackModal('cancelled');
        return;
      }

      try {
        const { open } = window.__TAURI__.dialog;
        // Default to the directory of the original file path
        const originalPath = this.missingTrackModal.filepath;
        const defaultDir = originalPath
          ? originalPath.substring(0, originalPath.lastIndexOf('/'))
          : undefined;

        const selected = await open({
          multiple: false,
          defaultPath: defaultDir,
          filters: [
            {
              name: 'Audio Files',
              extensions: ['mp3', 'flac', 'ogg', 'm4a', 'wav', 'aac', 'wma', 'opus'],
            },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (selected) {
          const trackId = this.missingTrackModal.track.id;
          await api.library.locate(trackId, selected);
          this.toast('File located successfully', 'success');
          this.closeMissingTrackModal('located', selected);
        } else {
          this.closeMissingTrackModal('cancelled');
        }
      } catch (error) {
        console.error('[ui] Failed to locate file:', error);
        this.toast('Failed to locate file: ' + error.message, 'error');
        this.closeMissingTrackModal('error');
      }
    },

    closeMissingTrackModal(result = 'cancelled', newPath = null) {
      if (this._missingTrackResolve) {
        this._missingTrackResolve({ result, newPath });
        this._missingTrackResolve = null;
      }
      this.missingTrackModal = null;
    },
  });

  // Setup watchers to sync store changes to backend settings
  // Using Alpine.effect() because stores don't have access to $watch
  if (window.settings && window.settings.initialized) {
    const store = Alpine.store('ui');
    let isInitializing = true;

    // Skip the first effect run to avoid syncing initial values
    Alpine.nextTick(() => {
      isInitializing = false;
    });

    // Watch each setting property and sync to backend
    Alpine.effect(() => {
      const value = store.sidebarOpen;
      if (!isInitializing) {
        window.settings.set('ui:sidebarOpen', value).catch((err) =>
          console.error('[ui] Failed to sync sidebarOpen:', err)
        );
      }
    });

    Alpine.effect(() => {
      const value = store.sidebarWidth;
      if (!isInitializing) {
        window.settings.set('ui:sidebarWidth', value).catch((err) =>
          console.error('[ui] Failed to sync sidebarWidth:', err)
        );
      }
    });

    Alpine.effect(() => {
      const value = store.libraryViewMode;
      if (!isInitializing) {
        window.settings.set('ui:libraryViewMode', value).catch((err) =>
          console.error('[ui] Failed to sync libraryViewMode:', err)
        );
      }
    });

    Alpine.effect(() => {
      const value = store.theme;
      if (!isInitializing) {
        window.settings.set('ui:theme', value).catch((err) =>
          console.error('[ui] Failed to sync theme:', err)
        );
      }
    });

    Alpine.effect(() => {
      const value = store.themePreset;
      if (!isInitializing) {
        window.settings.set('ui:themePreset', value).catch((err) =>
          console.error('[ui] Failed to sync themePreset:', err)
        );
      }
    });

    Alpine.effect(() => {
      const value = store.settingsSection;
      if (!isInitializing) {
        window.settings.set('ui:settingsSection', value).catch((err) =>
          console.error('[ui] Failed to sync settingsSection:', err)
        );
      }
    });

    Alpine.effect(() => {
      const value = store.sortIgnoreWords;
      if (!isInitializing) {
        window.settings.set('ui:sortIgnoreWords', value).catch((err) =>
          console.error('[ui] Failed to sync sortIgnoreWords:', err)
        );
      }
    });

    Alpine.effect(() => {
      const value = store.sortIgnoreWordsList;
      if (!isInitializing) {
        window.settings.set('ui:sortIgnoreWordsList', value).catch((err) =>
          console.error('[ui] Failed to sync sortIgnoreWordsList:', err)
        );
      }
    });
  }
}
