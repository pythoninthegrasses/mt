import { api } from '../api.js';
import { modLabel, SHORTCUT_DEFINITIONS } from '../shortcuts.js';

export function createSettingsView(Alpine) {
  Alpine.data('settingsView', () => ({
    appInfo: {
      version: '—',
      build: '—',
      platform: '—',
    },

    navSections: [
      { id: 'general', label: 'General' },
      { id: 'appearance', label: 'Appearance' },
      { id: 'library', label: 'Library' },
      { id: 'columns', label: 'Columns' },
      { id: 'shortcuts', label: 'Shortcuts' },
      { id: 'sorting', label: 'Sorting' },
      { id: 'advanced', label: 'Advanced' },
      { id: 'lastfm', label: 'Last.fm' },
    ],

    watchedFolders: [],
    watchedFoldersLoading: false,
    scanningFolders: new Set(),

    lastfm: {
      enabled: false,
      username: null,
      authenticated: false,
      scrobbleThreshold: 90,
      isConnecting: false,
      importInProgress: false,
      queueStatus: { queued_scrobbles: 0 },
      pendingToken: null,
      // Loved tracks cache
      lovedStats: { total_cached: 0, matched: 0, unmatched: 0 },
      isCachingLoved: false,
      isMatchingLoved: false,
      isResettingLoved: false,
    },

    reconcileScan: {
      isRunning: false,
      lastResult: null,
      progress: null,
    },

    // Column settings for Settings > Columns section
    columnSettings: {
      visibleCount: 0,
      hiddenCount: 0,
      hasCustomOrder: false,
      showResetConfirmation: true,
      // Reset option checkboxes
      resetWidths: true,
      resetOrder: true,
      resetVisibility: true,
      resetSort: true,
    },

    isExportingLogs: false,
    isDraggingThreshold: false,

    isSection(id) {
      return this.$store.ui.settingsSection === id;
    },

    navItemClass(sectionId) {
      return this.$store.ui.settingsSection === sectionId
        ? 'bg-primary/15 text-primary'
        : 'hover:bg-muted/70 text-foreground/80';
    },

    lastfmStatusColor() {
      if (this.lastfm.authenticated) return 'bg-green-500';
      if (this.lastfm.pendingToken) return 'bg-yellow-500';
      return 'bg-red-500';
    },

    lastfmStatusText() {
      if (this.lastfm.authenticated) {
        return this.lastfm.username ? 'Connected as ' + this.lastfm.username : 'Connected';
      }
      if (this.lastfm.pendingToken) return 'Awaiting Authorization';
      return 'Not Connected';
    },

    reconcilePhaseText() {
      if (!this.reconcileScan.progress) return '';
      return this.reconcileScan.progress.phase === 'fingerprinting'
        ? 'Computing fingerprints...'
        : 'Merging duplicates...';
    },

    reconcileProgressText() {
      const p = this.reconcileScan.progress;
      if (!p || p.total <= 0) return '';
      return `${p.current} / ${p.total}`;
    },

    reconcileProgressWidth() {
      const p = this.reconcileScan.progress;
      if (!p || p.total <= 0) return 'width: 0%';
      return `width: ${(p.current / p.total * 100)}%`;
    },

    canResetColumns() {
      return this.columnSettings.resetWidths ||
        this.columnSettings.resetOrder ||
        this.columnSettings.resetVisibility ||
        this.columnSettings.resetSort;
    },

    themeButtonClass(preset) {
      return this.$store.ui.themePreset === preset
        ? 'border-primary bg-primary/10 text-primary'
        : 'border-border hover:bg-muted/50';
    },

    scanButtonText() {
      return this.reconcileScan.isRunning ? 'Scanning...' : 'Run Scan';
    },

    rescanIconClass(folderId) {
      return this.isFolderScanning(folderId) ? 'animate-spin' : '';
    },

    toggleTrackClass() {
      return this.lastfm.enabled ? 'bg-primary' : 'bg-muted';
    },

    toggleThumbClass() {
      return this.lastfm.enabled ? 'translate-x-6' : 'translate-x-1';
    },

    connectButtonText() {
      return this.lastfm.isConnecting ? 'Connecting...' : 'Connect';
    },

    completeAuthButtonText() {
      return this.lastfm.isConnecting ? 'Completing...' : 'Complete Authentication';
    },

    cacheLovedButtonText() {
      return this.lastfm.isCachingLoved ? 'Syncing...' : 'Sync from Last.fm';
    },

    matchLovedButtonText() {
      return this.lastfm.isMatchingLoved ? 'Matching...' : 'Check for New Matches';
    },

    importLovedButtonText() {
      return this.lastfm.importInProgress ? 'Importing...' : 'Direct Import';
    },

    resetLovedButtonText() {
      return this.lastfm.isResettingLoved ? 'Resetting...' : 'Reset Cache';
    },

    async init() {
      await this.loadAppInfo();
      await this.loadWatchedFolders();
      await this.loadLastfmSettings();
      this.loadColumnSettings();
    },

    async loadAppInfo() {
      if (!window.__TAURI__) {
        this.appInfo = {
          version: 'dev',
          build: 'browser',
          platform: navigator.platform || 'unknown',
        };
        return;
      }

      try {
        const { invoke } = window.__TAURI__.core;
        const info = await invoke('app_get_info');
        this.appInfo = {
          version: info.version || '—',
          build: info.build || '—',
          platform: info.platform || '—',
        };
      } catch (error) {
        console.error('[settings] Failed to load app info:', error);
        this.appInfo = {
          version: 'unknown',
          build: 'unknown',
          platform: 'unknown',
        };
      }
    },

    async loadWatchedFolders() {
      if (!window.__TAURI__) return;

      this.watchedFoldersLoading = true;
      try {
        const { invoke } = window.__TAURI__.core;
        this.watchedFolders = await invoke('watched_folders_list');
      } catch (error) {
        console.error('[settings] Failed to load watched folders:', error);
        Alpine.store('ui').toast('Failed to load watched folders', 'error');
      } finally {
        this.watchedFoldersLoading = false;
      }
    },

    async addWatchedFolder() {
      if (!window.__TAURI__) {
        Alpine.store('ui').toast('Only available in desktop app', 'info');
        return;
      }

      try {
        const { open } = window.__TAURI__.dialog;
        const path = await open({ directory: true, multiple: false });
        if (!path) return;

        const { invoke } = window.__TAURI__.core;
        const folder = await invoke('watched_folders_add', {
          request: { path, mode: 'continuous', cadence_minutes: 10, enabled: true },
        });
        this.watchedFolders.push(folder);
        Alpine.store('ui').toast('Folder added to watch list', 'success');
      } catch (error) {
        console.error('[settings] Failed to add watched folder:', error);
        Alpine.store('ui').toast('Failed to add folder', 'error');
      }
    },

    async removeWatchedFolder(id) {
      if (!window.__TAURI__) return;

      try {
        const { invoke } = window.__TAURI__.core;
        await invoke('watched_folders_remove', { id });
      } catch (error) {
        // If the folder was already removed (e.g. by delete-all), just clean up the UI
        if (!error?.toString().includes('not found')) {
          console.error('[settings] Failed to remove watched folder:', error);
          Alpine.store('ui').toast('Failed to remove folder', 'error');
          return;
        }
      }
      this.watchedFolders = this.watchedFolders.filter((f) => f.id !== id);
      Alpine.store('ui').toast('Folder removed from watch list', 'success');
    },

    async updateWatchedFolder(id, updates) {
      if (!window.__TAURI__) return;

      try {
        const { invoke } = window.__TAURI__.core;
        const updated = await invoke('watched_folders_update', { id, request: updates });
        const index = this.watchedFolders.findIndex((f) => f.id === id);
        if (index !== -1) {
          this.watchedFolders[index] = updated;
        }
      } catch (error) {
        console.error('[settings] Failed to update watched folder:', error);
        Alpine.store('ui').toast('Failed to update folder', 'error');
      }
    },

    async rescanWatchedFolder(id) {
      if (!window.__TAURI__) return;

      this.scanningFolders.add(id);
      try {
        const { invoke } = window.__TAURI__.core;
        await invoke('watched_folders_rescan', { id });
        Alpine.store('ui').toast('Rescan started', 'success');
      } catch (error) {
        console.error('[settings] Failed to rescan folder:', error);
        Alpine.store('ui').toast('Failed to start rescan', 'error');
      } finally {
        this.scanningFolders.delete(id);
      }
    },

    isFolderScanning(id) {
      return this.scanningFolders.has(id);
    },

    truncatePath(path, maxLength = 50) {
      if (!path || path.length <= maxLength) return path;
      const start = path.slice(0, 20);
      const end = path.slice(-25);
      return `${start}...${end}`;
    },

    async resetSettings() {
      let confirmed = false;

      if (window.__TAURI__?.dialog?.confirm) {
        confirmed = await window.__TAURI__.dialog.confirm(
          'This will reset all settings to their defaults. Your library and playlists will not be affected.',
          { title: 'Reset Settings', kind: 'warning' },
        );
      } else {
        confirmed = confirm(
          'This will reset all settings to their defaults. Your library and playlists will not be affected.',
        );
      }

      if (!confirmed) return;

      const keysToReset = [
        'mt:ui:themePreset',
        'mt:ui:theme',
        'mt:settings:activeSection',
      ];

      keysToReset.forEach((key) => localStorage.removeItem(key));

      window.location.reload();
    },

    async exportLogs() {
      if (!window.__TAURI__) {
        Alpine.store('ui').toast('Export logs is only available in the desktop app', 'info');
        return;
      }

      this.isExportingLogs = true;
      try {
        const { invoke } = window.__TAURI__.core;
        const { save } = window.__TAURI__.dialog;

        const path = await save({
          defaultPath: `mt_diagnostics_${new Date().toISOString().slice(0, 10)}.log`,
          filters: [{ name: 'Log Files', extensions: ['log'] }],
        });

        if (!path) {
          this.isExportingLogs = false;
          return;
        }

        await invoke('export_diagnostics', { path });
        Alpine.store('ui').toast('Diagnostics exported successfully', 'success');
      } catch (error) {
        console.error('[settings] Failed to export logs:', error);
        Alpine.store('ui').toast('Failed to export diagnostics', 'error');
      } finally {
        this.isExportingLogs = false;
      }
    },

    // ============================================
    // Last.fm methods
    // ============================================

    async loadLastfmSettings() {
      try {
        const settings = await api.lastfm.getSettings();
        this.lastfm.enabled = settings.enabled;
        this.lastfm.username = settings.username;
        this.lastfm.authenticated = settings.authenticated;
        this.lastfm.scrobbleThreshold = settings.scrobble_threshold;

        // Load queue status and loved stats if authenticated
        if (settings.authenticated) {
          await this.loadQueueStatus();
          await this.loadLovedStats();
        }
      } catch (error) {
        console.error('[settings] Failed to load Last.fm settings:', error);
        Alpine.store('ui').toast('Failed to load Last.fm settings', 'error');
      }
    },

    async toggleLastfm() {
      try {
        await api.lastfm.updateSettings({
          enabled: !this.lastfm.enabled,
        });
        this.lastfm.enabled = !this.lastfm.enabled;
        Alpine.store('ui').toast(
          `Last.fm scrobbling ${this.lastfm.enabled ? 'enabled' : 'disabled'}`,
          'success',
        );
      } catch (error) {
        console.error('[settings] Failed to toggle Last.fm:', error);
        Alpine.store('ui').toast('Failed to update Last.fm settings', 'error');
      }
    },

    async updateScrobbleThreshold() {
      try {
        // Clamp value to valid range
        const clampedValue = Math.max(25, Math.min(100, this.lastfm.scrobbleThreshold));
        if (clampedValue !== this.lastfm.scrobbleThreshold) {
          this.lastfm.scrobbleThreshold = clampedValue;
        }

        await api.lastfm.updateSettings({
          scrobble_threshold: this.lastfm.scrobbleThreshold,
        });
        Alpine.store('ui').toast('Scrobble threshold updated', 'success');
      } catch (error) {
        console.error('[settings] Failed to update scrobble threshold:', error);
        Alpine.store('ui').toast('Failed to update scrobble threshold', 'error');
      }
    },

    async connectLastfm() {
      this.lastfm.isConnecting = true;
      try {
        const response = await api.lastfm.getAuthUrl();
        const authUrl = response.auth_url;
        const token = response.token;

        // Store the token for completing authentication
        this.lastfm.pendingToken = token;

        // Open auth URL in browser
        if (window.__TAURI__) {
          // In Tauri app, use shell.open
          const { open } = window.__TAURI__.shell;
          await open(authUrl);
        } else {
          // In browser, open new tab
          window.open(authUrl, '_blank', 'noopener,noreferrer');
        }

        Alpine.store('ui').toast(
          'Last.fm authorization page opened. After authorizing, click "Complete Authentication".',
          'info',
        );
      } catch (error) {
        console.error('[settings] Failed to get Last.fm auth URL:', error);
        // Show the actual error message from backend
        const errorMsg = error.message || error.toString();
        Alpine.store('ui').toast(
          errorMsg.includes('API keys not configured')
            ? 'Last.fm API keys not configured. Set LASTFM_API_KEY and LASTFM_API_SECRET in .env file.'
            : `Failed to connect: ${errorMsg}`,
          'error',
        );
        this.lastfm.pendingToken = null;
      } finally {
        this.lastfm.isConnecting = false;
      }
    },

    async completeLastfmAuth() {
      if (!this.lastfm.pendingToken) {
        Alpine.store('ui').toast(
          'No pending authentication. Please start the connection process first.',
          'warning',
        );
        return;
      }

      this.lastfm.isConnecting = true;
      try {
        const result = await api.lastfm.completeAuth(this.lastfm.pendingToken);
        this.lastfm.authenticated = true;
        this.lastfm.username = result.username;
        this.lastfm.enabled = true;
        this.lastfm.pendingToken = null;
        Alpine.store('ui').toast(
          `Successfully connected to Last.fm as ${result.username}`,
          'success',
        );

        // Load queue status now that we're authenticated
        await this.loadQueueStatus();
      } catch (error) {
        console.error('[settings] Failed to complete Last.fm authentication:', error);
        const errorMsg = error.message || error.toString();
        Alpine.store('ui').toast(
          `Failed to complete authentication: ${errorMsg}`,
          'error',
        );
      } finally {
        this.lastfm.isConnecting = false;
      }
    },

    cancelLastfmAuth() {
      this.lastfm.pendingToken = null;
      Alpine.store('ui').toast('Authentication cancelled', 'info');
    },

    async disconnectLastfm() {
      try {
        await api.lastfm.disconnect();
        this.lastfm.enabled = false;
        this.lastfm.username = null;
        this.lastfm.authenticated = false;
        Alpine.store('ui').toast('Disconnected from Last.fm', 'success');
      } catch (error) {
        console.error('[settings] Failed to disconnect from Last.fm:', error);
        Alpine.store('ui').toast('Failed to disconnect from Last.fm', 'error');
      }
    },

    async importLovedTracks() {
      if (!this.lastfm.authenticated) {
        Alpine.store('ui').toast('Please connect to Last.fm first', 'warning');
        return;
      }

      this.lastfm.importInProgress = true;
      try {
        const result = await api.lastfm.importLovedTracks();
        Alpine.store('ui').toast(
          `Imported ${result.imported_count} loved tracks from Last.fm`,
          'success',
        );

        // Refresh library to show updated favorites
        Alpine.store('library').load({ forceReload: true });
      } catch (error) {
        console.error('[settings] Failed to import loved tracks:', error);
        Alpine.store('ui').toast('Failed to import loved tracks', 'error');
      } finally {
        this.lastfm.importInProgress = false;
      }
    },

    async loadQueueStatus() {
      try {
        this.lastfm.queueStatus = await api.lastfm.getQueueStatus();
      } catch (error) {
        console.error('[settings] Failed to load queue status:', error);
      }
    },

    async retryQueuedScrobbles() {
      try {
        const result = await api.lastfm.retryQueuedScrobbles();
        Alpine.store('ui').toast(
          `Retried queued scrobbles. ${result.remaining_queued} remaining.`,
          'success',
        );
        await this.loadQueueStatus();
      } catch (error) {
        console.error('[settings] Failed to retry queued scrobbles:', error);
        Alpine.store('ui').toast('Failed to retry queued scrobbles', 'error');
      }
    },

    async loadLovedStats() {
      try {
        this.lastfm.lovedStats = await api.lastfm.getLovedStats();
      } catch (error) {
        console.error('[settings] Failed to load loved stats:', error);
      }
    },

    async cacheLovedTracks() {
      if (!this.lastfm.authenticated) {
        Alpine.store('ui').toast('Please connect to Last.fm first', 'warning');
        return;
      }

      this.lastfm.isCachingLoved = true;
      try {
        const result = await api.lastfm.cacheLovedTracks();
        Alpine.store('ui').toast(
          `Cached ${result.new_tracks} new loved tracks (${result.total_cached} total)`,
          'success',
        );
        await this.loadLovedStats();
      } catch (error) {
        console.error('[settings] Failed to cache loved tracks:', error);
        Alpine.store('ui').toast('Failed to cache loved tracks', 'error');
      } finally {
        this.lastfm.isCachingLoved = false;
      }
    },

    async matchLovedTracks() {
      if (!this.lastfm.authenticated) {
        Alpine.store('ui').toast('Please connect to Last.fm first', 'warning');
        return;
      }

      this.lastfm.isMatchingLoved = true;
      try {
        const result = await api.lastfm.matchLovedTracks();
        if (result.new_favorites > 0) {
          Alpine.store('ui').toast(
            `Found ${result.matched} matches, added ${result.new_favorites} new favorites`,
            'success',
          );
          // Refresh library to show updated favorites
          Alpine.store('library').load({ forceReload: true });
        } else if (result.matched > 0) {
          Alpine.store('ui').toast(
            `Found ${result.matched} matches (already favorited)`,
            'info',
          );
        } else {
          Alpine.store('ui').toast('No new matches found', 'info');
        }
        await this.loadLovedStats();
      } catch (error) {
        console.error('[settings] Failed to match loved tracks:', error);
        Alpine.store('ui').toast('Failed to match loved tracks', 'error');
      } finally {
        this.lastfm.isMatchingLoved = false;
      }
    },

    async resetLovedCache() {
      let confirmed = false;

      if (window.__TAURI__?.dialog?.confirm) {
        confirmed = await window.__TAURI__.dialog.confirm(
          'This will clear the loved tracks cache and remove auto-favorited tracks (synced from Last.fm). Manually favorited tracks are kept.\n\nYou can re-sync from Last.fm afterward to rebuild the cache.',
          { title: 'Reset Loved Tracks Cache', kind: 'warning' },
        );
      } else {
        confirmed = confirm(
          'This will clear the loved tracks cache and remove auto-favorited tracks (synced from Last.fm). Manually favorited tracks are kept.\n\nYou can re-sync from Last.fm afterward to rebuild the cache.',
        );
      }

      if (!confirmed) return;

      this.lastfm.isResettingLoved = true;
      try {
        const result = await api.lastfm.resetLovedCache();
        const parts = [`Cleared ${result.cleared} cached tracks`];
        if (result.unfavorited > 0) {
          parts.push(`removed ${result.unfavorited} auto-favorited`);
        }
        Alpine.store('ui').toast(parts.join(', '), 'success');
        await this.loadLovedStats();
      } catch (error) {
        console.error('[settings] Failed to reset loved cache:', error);
        Alpine.store('ui').toast('Failed to reset loved cache', 'error');
      } finally {
        this.lastfm.isResettingLoved = false;
      }
    },

    // ============================================
    // Library Reconciliation methods
    // ============================================

    async runReconcileScan() {
      if (!window.__TAURI__) {
        Alpine.store('ui').toast('Only available in desktop app', 'info');
        return;
      }

      this.reconcileScan.isRunning = true;
      this.reconcileScan.progress = null;

      let unlisten = null;
      try {
        const { invoke } = window.__TAURI__.core;
        const { listen } = window.__TAURI__.event;

        unlisten = await listen('reconcile:progress', (e) => {
          this.reconcileScan.progress = e.payload;
        });

        const result = await invoke('library_reconcile_scan');
        this.reconcileScan.lastResult = result;

        const total = result.backfilled + result.duplicates_merged;
        if (total > 0) {
          Alpine.store('ui').toast(
            `Scan complete: ${result.backfilled} backfilled, ${result.duplicates_merged} duplicates merged`,
            'success',
          );
          // Refresh library to reflect merged/updated tracks
          Alpine.store('library').load({ forceReload: true });
        } else {
          Alpine.store('ui').toast('Scan complete: no changes needed', 'info');
        }
      } catch (error) {
        console.error('[settings] Reconcile scan failed:', error);
        Alpine.store('ui').toast('Reconcile scan failed', 'error');
      } finally {
        if (unlisten) unlisten();
        this.reconcileScan.isRunning = false;
        this.reconcileScan.progress = null;
      }
    },

    // ============================================
    // Column Settings methods
    // ============================================

    loadColumnSettings() {
      // Default column order for comparison
      const defaultOrder = [
        'status',
        'index',
        'title',
        'artist',
        'album',
        'year',
        'duration',
        'lastPlayed',
        'dateAdded',
        'playCount',
        'genre',
        'trackTotal',
        'discNumber',
      ];

      // Default visibility
      const defaultVisibility = {
        status: true,
        index: true,
        title: true,
        artist: true,
        album: true,
        year: true,
        genre: false,
        trackTotal: false,
        discNumber: false,
        lastPlayed: true,
        dateAdded: true,
        playCount: true,
        duration: true,
      };

      if (window.settings?.initialized) {
        // Load column visibility and order from settings
        const visibility = window.settings.get('library:columnVisibility', defaultVisibility);
        const order = window.settings.get('library:columnOrder', defaultOrder);
        const showConfirm = window.settings.get('columns:showResetConfirmation', true);

        // Count visible and hidden columns
        const allColumnKeys = Object.keys(defaultVisibility);
        let visibleCount = 0;
        let hiddenCount = 0;

        allColumnKeys.forEach((key) => {
          if (visibility[key] !== false) {
            visibleCount++;
          } else {
            hiddenCount++;
          }
        });

        // Check if order differs from default
        const hasCustomOrder = order.length !== defaultOrder.length ||
          order.some((key, idx) => defaultOrder[idx] !== key);

        this.columnSettings.visibleCount = visibleCount;
        this.columnSettings.hiddenCount = hiddenCount;
        this.columnSettings.hasCustomOrder = hasCustomOrder;
        this.columnSettings.showResetConfirmation = showConfirm;
      } else {
        // Use defaults when settings not available
        const allColumnKeys = Object.keys(defaultVisibility);
        this.columnSettings.visibleCount = allColumnKeys.filter((k) => defaultVisibility[k]).length;
        this.columnSettings.hiddenCount = allColumnKeys.filter((k) => !defaultVisibility[k]).length;
        this.columnSettings.hasCustomOrder = false;
        this.columnSettings.showResetConfirmation = true;
      }
    },

    async saveColumnConfirmationSetting() {
      if (window.settings?.initialized) {
        try {
          await window.settings.set(
            'columns:showResetConfirmation',
            this.columnSettings.showResetConfirmation,
          );
        } catch (error) {
          console.error('[settings] Failed to save column confirmation setting:', error);
        }
      }
    },

    async resetSelectedColumnSettings() {
      // Check if confirmation is needed
      if (this.columnSettings.showResetConfirmation) {
        const parts = [];
        if (this.columnSettings.resetWidths) parts.push('widths');
        if (this.columnSettings.resetOrder) parts.push('order');
        if (this.columnSettings.resetVisibility) parts.push('visibility');
        if (this.columnSettings.resetSort) parts.push('sort settings');

        const message = `Reset column ${parts.join(', ')}?`;

        let confirmed = false;
        if (window.__TAURI__?.dialog?.confirm) {
          confirmed = await window.__TAURI__.dialog.confirm(message, {
            title: 'Reset Column Settings',
            kind: 'warning',
          });
        } else {
          confirmed = confirm(message);
        }

        if (!confirmed) return;
      }

      // Default values for reset (must match DEFAULT_COLUMN_WIDTHS in library-browser.js)
      const defaultWidths = {
        status: 24,
        index: 48,
        title: 320,
        artist: 431,
        album: 411,
        year: 70,
        genre: 120,
        trackTotal: 60,
        discNumber: 60,
        lastPlayed: 120,
        dateAdded: 120,
        playCount: 83,
        duration: 52,
      };
      const defaultOrder = [
        'status',
        'index',
        'title',
        'artist',
        'album',
        'year',
        'duration',
        'lastPlayed',
        'dateAdded',
        'playCount',
        'genre',
        'trackTotal',
        'discNumber',
      ];
      const defaultVisibility = {
        status: true,
        index: true,
        title: true,
        artist: true,
        album: true,
        year: true,
        genre: false,
        trackTotal: false,
        discNumber: false,
        lastPlayed: true,
        dateAdded: true,
        playCount: true,
        duration: true,
      };

      try {
        if (window.settings?.initialized) {
          if (this.columnSettings.resetWidths) {
            await window.settings.set('library:columnWidths', defaultWidths);
          }
          if (this.columnSettings.resetOrder) {
            await window.settings.set('library:columnOrder', defaultOrder);
          }
          if (this.columnSettings.resetVisibility) {
            await window.settings.set('library:columnVisibility', defaultVisibility);
          }
          if (this.columnSettings.resetSort) {
            // Reset sort to default (no sort)
            const library = Alpine.store('library');
            if (library) {
              library.sortBy = 'default';
              library.sortOrder = 'asc';
              library.applyFilters();
            }
          }
        }

        // Dispatch event to notify library browser to reload settings
        window.dispatchEvent(new CustomEvent('mt:column-settings-reset'));

        // Reload column settings to update UI
        this.loadColumnSettings();

        Alpine.store('ui').toast('Column settings reset', 'success');
      } catch (error) {
        console.error('[settings] Failed to reset column settings:', error);
        Alpine.store('ui').toast('Failed to reset column settings', 'error');
      }
    },
  }));
}

export function createShortcutsSettings(Alpine) {
  const mod = modLabel();
  const all = SHORTCUT_DEFINITIONS.map((s) => ({
    ...s,
    label: s.label.replace('{mod}', mod),
  }));

  Alpine.data('shortcutsSettings', () => ({
    playback: all.filter((s) =>
      [
        'Play / Pause',
        'Next track',
        'Seek forward 5s',
        'Previous track',
        'Seek back 5s',
        'Cycle loop mode',
        'Toggle shuffle',
      ].includes(s.action)
    ),
    volume: all.filter((s) => ['Volume up', 'Volume down', 'Mute / Unmute'].includes(s.action)),
    navigation: all.filter((s) =>
      ['Focus search', 'Clear search / Close dialogs', 'Toggle settings'].includes(s.action)
    ),
    contextAware: all.filter((s) => s.context),
  }));
}

export default createSettingsView;
