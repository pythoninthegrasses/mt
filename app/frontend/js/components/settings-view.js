import { audio } from '../api/audio.js';
import { lastfm } from '../api/lastfm.js';
import { plex } from '../api/plex.js';
import { settings } from '../api/settings.js';
import { tauriConfirm, tauriInvoke } from '../api/shared.js';
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
      { id: 'audio', label: 'Audio' },
      { id: 'appearance', label: 'Appearance' },
      { id: 'library', label: 'Library' },
      { id: 'columns', label: 'Columns' },
      { id: 'shortcuts', label: 'Shortcuts' },
      { id: 'sorting', label: 'Sorting' },
      { id: 'advanced', label: 'Advanced' },
      { id: 'lastfm', label: 'Last.fm' },
      { id: 'plex', label: 'Plex' },
      { id: 'stats', label: 'Statistics' },
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

    plex: {
      url: '',
      token: '',
      serverName: null,
      machineId: null,
      version: null,
      libraries: [],
      selectedLibraries: [],
      isConnecting: false,
      isDiscovering: false,
      connected: false,
    },

    reconcileScan: {
      isRunning: false,
      lastResult: null,
      progress: null,
    },

    networkCache: {
      enabled: false,
      persistent: false,
      maxGb: 2,
      usedBytes: 0,
      fileCount: 0,
      isPurging: false,
    },

    audioDevices: [],
    selectedAudioDevice: 'default',
    audioDevicesLoading: false,

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

    deduplicateAcrossDirectories: true,
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
      const phase = this.reconcileScan.progress.phase;
      if (phase === 'fingerprinting') return 'Computing fingerprints...';
      if (phase === 'cross_directory_dedup') return 'Cross-directory dedup...';
      return 'Merging duplicates...';
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

    networkCacheToggleTrackClass() {
      return this.networkCache.enabled ? 'bg-primary' : 'bg-muted';
    },

    networkCacheToggleThumbClass() {
      return this.networkCache.enabled ? 'translate-x-6' : 'translate-x-1';
    },

    networkCachePersistentTrackClass() {
      return this.networkCache.persistent ? 'bg-primary' : 'bg-muted';
    },

    networkCachePersistentThumbClass() {
      return this.networkCache.persistent ? 'translate-x-6' : 'translate-x-1';
    },

    purgeButtonText() {
      return this.networkCache.isPurging ? 'Clearing...' : 'Clear Cache';
    },

    formatCacheSize(bytes) {
      if (bytes === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
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

    _audioDevicesLoaded: false,

    async init() {
      await this.loadAppInfo();
      // Audio device enumeration is deferred until the settings view
      // becomes visible — calling into CoreAudio too early at launch
      // can trigger a SIGSEGV in HALDeviceList::GetData() on macOS.
      this.$watch('$store.ui.view', (view) => {
        if (view === 'settings' && !this._audioDevicesLoaded) {
          this._audioDevicesLoaded = true;
          this.loadAudioDevices();
        }
      });
      await this.loadWatchedFolders();
      await this.loadLastfmSettings();
      await this.loadPlexSettings();
      await this.loadNetworkCacheStatus();
      this.loadColumnSettings();
      this.deduplicateAcrossDirectories = window.settings.get(
        'library.deduplicateAcrossDirectories',
        true,
      );
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
        const info = await tauriInvoke('app_get_info');
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

    async loadAudioDevices() {
      this.audioDevicesLoading = true;
      try {
        const response = await audio.listDevices();
        this.audioDevices = response.devices || [];

        // Load saved device selection
        const saved = await settings.get('audio_output_device');
        if (saved && saved.value && saved.value !== 'default') {
          this.selectedAudioDevice = saved.value;
        } else {
          this.selectedAudioDevice = 'default';
        }
      } catch (error) {
        console.error('[settings] Failed to load audio devices:', error);
        this.audioDevices = [];
      } finally {
        this.audioDevicesLoading = false;
      }
    },

    async setAudioDevice(deviceName) {
      const previous = this.selectedAudioDevice;
      this.selectedAudioDevice = deviceName;
      try {
        await audio.setDevice(deviceName === 'default' ? null : deviceName);
      } catch (error) {
        console.error('[settings] Failed to set audio device:', error);
        this.selectedAudioDevice = previous;
      }
    },

    async loadWatchedFolders() {
      if (!window.__TAURI__) return;

      this.watchedFoldersLoading = true;
      try {
        this.watchedFolders = await tauriInvoke('watched_folders_list');
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

        const folder = await tauriInvoke('watched_folders_add', {
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
        await tauriInvoke('watched_folders_remove', { id });
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
        const updated = await tauriInvoke('watched_folders_update', { id, request: updates });
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
        await tauriInvoke('watched_folders_rescan', { id });
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
      const confirmed = await tauriConfirm(
        'This will reset all settings to their defaults. Your library and playlists will not be affected.',
        { title: 'Reset Settings', kind: 'warning' },
      );

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
        const { save } = window.__TAURI__.dialog;

        const path = await save({
          defaultPath: `mt_diagnostics_${new Date().toISOString().slice(0, 10)}.log`,
          filters: [{ name: 'Log Files', extensions: ['log'] }],
        });

        if (!path) {
          this.isExportingLogs = false;
          return;
        }

        await tauriInvoke('export_diagnostics', { path });
        Alpine.store('ui').toast('Diagnostics exported successfully', 'success');
      } catch (error) {
        console.error('[settings] Failed to export logs:', error);
        Alpine.store('ui').toast('Failed to export diagnostics', 'error');
      } finally {
        this.isExportingLogs = false;
      }
    },

    // ============================================
    // Network Cache methods
    // ============================================

    async loadNetworkCacheStatus() {
      if (!window.__TAURI__) return;

      try {
        const status = await tauriInvoke('network_cache_status');
        this.networkCache.enabled = status.enabled;
        this.networkCache.persistent = status.persistent;
        this.networkCache.maxGb = status.max_bytes / 1_073_741_824;
        this.networkCache.usedBytes = status.used_bytes;
        this.networkCache.fileCount = status.file_count;
      } catch (error) {
        console.error('[settings] Failed to load network cache status:', error);
      }
    },

    async toggleNetworkCache() {
      if (!window.__TAURI__) return;

      try {
        const newValue = !this.networkCache.enabled;
        await window.settings.set('network_cache_enabled', newValue);
        this.networkCache.enabled = newValue;
        Alpine.store('ui').toast(
          `Network file caching ${newValue ? 'enabled' : 'disabled'}`,
          'success',
        );
      } catch (error) {
        console.error('[settings] Failed to toggle network cache:', error);
        Alpine.store('ui').toast('Failed to update network cache setting', 'error');
      }
    },

    async toggleNetworkCachePersistent() {
      if (!window.__TAURI__) return;

      try {
        const newValue = !this.networkCache.persistent;
        await window.settings.set('network_cache_persistent', newValue);
        this.networkCache.persistent = newValue;
        Alpine.store('ui').toast(
          `Persistent cache ${newValue ? 'enabled' : 'disabled'}`,
          'success',
        );
      } catch (error) {
        console.error('[settings] Failed to toggle persistent cache:', error);
        Alpine.store('ui').toast('Failed to update persistent cache setting', 'error');
      }
    },

    async updateNetworkCacheMaxGb() {
      if (!window.__TAURI__) return;

      try {
        const clamped = Math.max(0.5, Math.min(20, this.networkCache.maxGb));
        if (clamped !== this.networkCache.maxGb) {
          this.networkCache.maxGb = clamped;
        }

        await window.settings.set('network_cache_max_gb', this.networkCache.maxGb);
      } catch (error) {
        console.error('[settings] Failed to update cache size limit:', error);
        Alpine.store('ui').toast('Failed to update cache size limit', 'error');
      }
    },

    async purgeNetworkCache() {
      if (!window.__TAURI__) return;

      this.networkCache.isPurging = true;
      try {
        await tauriInvoke('network_cache_purge');
        this.networkCache.usedBytes = 0;
        this.networkCache.fileCount = 0;
        Alpine.store('ui').toast('Network cache cleared', 'success');
      } catch (error) {
        console.error('[settings] Failed to purge network cache:', error);
        Alpine.store('ui').toast('Failed to clear network cache', 'error');
      } finally {
        this.networkCache.isPurging = false;
      }
    },

    // ============================================
    // Last.fm methods
    // ============================================

    async loadLastfmSettings() {
      try {
        const settings = await lastfm.getSettings();
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
        await lastfm.updateSettings({
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

        await lastfm.updateSettings({
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
        const response = await lastfm.getAuthUrl();
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
        const result = await lastfm.completeAuth(this.lastfm.pendingToken);
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
        await lastfm.disconnect();
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
        const result = await lastfm.importLovedTracks();
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
        this.lastfm.queueStatus = await lastfm.getQueueStatus();
      } catch (error) {
        console.error('[settings] Failed to load queue status:', error);
      }
    },

    async retryQueuedScrobbles() {
      try {
        const result = await lastfm.retryQueuedScrobbles();
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
        this.lastfm.lovedStats = await lastfm.getLovedStats();
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
        const result = await lastfm.cacheLovedTracks();
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
        const result = await lastfm.matchLovedTracks();
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
      const confirmed = await tauriConfirm(
        'This will clear the loved tracks cache and remove auto-favorited tracks (synced from Last.fm). Manually favorited tracks are kept.\n\nYou can re-sync from Last.fm afterward to rebuild the cache.',
        { title: 'Reset Loved Tracks Cache', kind: 'warning' },
      );

      if (!confirmed) return;

      this.lastfm.isResettingLoved = true;
      try {
        const result = await lastfm.resetLovedCache();
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

    async toggleDeduplicateAcrossDirectories() {
      try {
        await window.settings.set(
          'library.deduplicateAcrossDirectories',
          this.deduplicateAcrossDirectories,
        );
      } catch (err) {
        console.error('[settings] Failed to save dedup setting:', err);
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
        const { listen } = window.__TAURI__.event;

        unlisten = await listen('reconcile:progress', (e) => {
          this.reconcileScan.progress = e.payload;
        });

        const result = await tauriInvoke('library_reconcile_scan');
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
    // Plex methods
    // ============================================

    plexStatusColor() {
      return this.plex.connected ? 'bg-green-500' : 'bg-red-500';
    },

    plexStatusText() {
      if (this.plex.connected) {
        return this.plex.serverName ? `Connected to ${this.plex.serverName}` : 'Connected';
      }
      return 'Not Connected';
    },

    async loadPlexSettings() {
      if (!window.__TAURI__) return;

      try {
        const config = await plex.getConfig();
        if (config?.status === 'configured') {
          this.plex.url = config.url;
          this.plex.token = config.token;
          this.plex.selectedLibraries = config.libraries ?? [];
          this.plex.connected = true;
          try {
            this.plex.libraries = await plex.listLibrariesCurrent();
          } catch (error) {
            console.warn('[settings] Could not refresh Plex libraries list:', error);
          }
          this._syncPlex();
        }
      } catch (error) {
        console.error('[settings] Failed to load Plex settings:', error);
      }
    },

    async connectPlex() {
      if (!this.plex.url || !this.plex.token) {
        Alpine.store('ui').toast('Server URL and token are required', 'warning');
        return;
      }

      this.plex.isConnecting = true;
      try {
        const info = await plex.ping(this.plex.url, this.plex.token);
        this.plex.serverName = info.server_name;
        this.plex.machineId = info.machine_id;
        this.plex.version = info.version;

        await plex.setConfig(this.plex.url, this.plex.token, this.plex.selectedLibraries);
        this.plex.connected = true;
        Alpine.store('settings').plex_configured = true;
        Alpine.store('ui').toast(`Connected to ${info.server_name}`, 'success');
        this._syncPlex();
      } catch (error) {
        console.error('[settings] Failed to connect to Plex:', error);
        Alpine.store('ui').toast(`Failed to connect: ${error}`, 'error');
      } finally {
        this.plex.isConnecting = false;
      }
    },

    _syncPlex() {
      plex
        .sync()
        .then((stats) => {
          if (!stats) return;
          if (stats.inserted > 0 || stats.linked > 0) {
            Alpine.store('library').fetchTracks();
            const parts = [
              stats.inserted > 0 ? `${stats.inserted} new` : '',
              stats.linked > 0 ? `${stats.linked} linked` : '',
            ].filter(Boolean);
            Alpine.store('ui').toast(`Plex sync: ${parts.join(', ')}`, 'success', 4000);
          }
        })
        .catch((error) => {
          console.error('[settings] Plex sync failed:', error);
        });
    },

    async disconnectPlex() {
      try {
        await plex.clearConfig();
        this.plex.url = '';
        this.plex.token = '';
        this.plex.serverName = null;
        this.plex.machineId = null;
        this.plex.version = null;
        this.plex.libraries = [];
        this.plex.selectedLibraries = [];
        this.plex.connected = false;
        Alpine.store('settings').plex_configured = false;
        Alpine.store('ui').toast('Disconnected from Plex', 'success');
      } catch (error) {
        console.error('[settings] Failed to disconnect from Plex:', error);
        Alpine.store('ui').toast('Failed to disconnect from Plex', 'error');
      }
    },

    async discoverPlexLibraries() {
      if (!this.plex.url || !this.plex.token) {
        Alpine.store('ui').toast('Server URL and token are required', 'warning');
        return;
      }

      this.plex.isDiscovering = true;
      try {
        this.plex.libraries = await plex.listLibraries(this.plex.url, this.plex.token);
        if (this.plex.libraries.length === 0) {
          Alpine.store('ui').toast('No music libraries found on this server', 'info');
        }
      } catch (error) {
        console.error('[settings] Failed to discover Plex libraries:', error);
        Alpine.store('ui').toast(`Failed to discover libraries: ${error}`, 'error');
      } finally {
        this.plex.isDiscovering = false;
      }
    },

    plexLibrarySelected(key) {
      return this.plex.selectedLibraries.includes(key);
    },

    async togglePlexLibrary(key) {
      const next = this.plex.selectedLibraries.includes(key)
        ? this.plex.selectedLibraries.filter((k) => k !== key)
        : [...this.plex.selectedLibraries, key];
      this.plex.selectedLibraries = next;
      if (!this.plex.connected) return;
      try {
        await plex.setLibraries(next);
        this._syncPlex();
      } catch (error) {
        console.error('[settings] Failed to save Plex library selection:', error);
        Alpine.store('ui').toast('Failed to save library selection', 'error');
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
        const confirmed = await tauriConfirm(message, {
          title: 'Reset Column Settings',
          kind: 'warning',
        });

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
