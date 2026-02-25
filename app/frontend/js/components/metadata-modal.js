import { formatDuration } from '../utils/formatting.js';

export function createMetadataModal(Alpine) {
  Alpine.data('metadataModal', () => ({
    isOpen: false,
    isLoading: false,
    isSaving: false,
    tracks: [],
    library: null,
    metadata: {
      title: '',
      artist: '',
      album: '',
      album_artist: '',
      track_number: '',
      track_total: '',
      disc_number: '',
      disc_total: '',
      year: '',
      genre: '',
    },
    originalMetadata: {},
    mixedFields: new Set(),
    fileInfo: {
      format: '',
      duration: '',
      bitrate: '',
      sample_rate: '',
      channels: '',
      path: '',
    },

    navigationEnabled: false,
    currentTrackId: null,
    _batchTrackIds: [],
    _batchOrderedIds: [],
    _sessionId: null,

    init() {
      this.$watch('$store.ui.modal', (modal) => {
        if (modal?.type === 'editMetadata') {
          // Guard against re-opening: if already open, only proceed if sessionId changed
          // (both undefined and null are treated as "no session")
          const currentSession = this._sessionId ?? undefined;
          const newSession = modal.data?.sessionId ?? undefined;
          if (this.isOpen && currentSession === newSession) {
            return;
          }
          this.open(modal.data);
        } else if (this.isOpen) {
          this.close();
        }
      });
    },

    get isBatchEdit() {
      return this.tracks.length > 1;
    },

    get modalTitle() {
      if (this.isBatchEdit) {
        return `Edit Metadata (${this.tracks.length} tracks)`;
      }
      return 'Edit Metadata';
    },

    get libraryTracks() {
      return Alpine.store('library').filteredTracks;
    },

    get currentBatchIndex() {
      if (!this.currentTrackId || !this._batchOrderedIds.length) return -1;
      return this._batchOrderedIds.indexOf(this.currentTrackId);
    },

    get canNavigatePrev() {
      return this.navigationEnabled && this.currentBatchIndex > 0;
    },

    get canNavigateNext() {
      return this.navigationEnabled && this.currentBatchIndex >= 0 &&
        this.currentBatchIndex < this._batchOrderedIds.length - 1;
    },

    get navIndicator() {
      if (!this.navigationEnabled) return '';
      if (this.isBatchEdit) return `${this.tracks.length} tracks`;
      return `${this.currentBatchIndex + 1} / ${this._batchOrderedIds.length}`;
    },

    get hasUnsavedChanges() {
      const fields = [
        'title',
        'artist',
        'album',
        'album_artist',
        'track_number',
        'track_total',
        'disc_number',
        'disc_total',
        'year',
        'genre',
      ];
      return fields.some((field) => this.hasFieldChanged(field));
    },

    async open(data) {
      this.tracks = data.tracks || (data.track ? [data.track] : []);
      this.library = data.library;
      this.isOpen = true;
      this.isLoading = true;
      this.mixedFields = new Set();

      this._sessionId = data.sessionId || null;
      this.navigationEnabled = this.libraryTracks.length > 1;
      this._batchTrackIds = this.tracks.map((t) => t.id);

      this._batchOrderedIds = this.libraryTracks.map((t) => t.id);

      this.currentTrackId = null;

      try {
        await this.loadMetadata();

        // Initialize currentTrackId for navigation (use original selection order)
        if (this._batchTrackIds.length > 0) {
          this.currentTrackId = this._batchTrackIds[0];
        }
      } catch (error) {
        console.error('[metadata] Failed to load metadata:', error);
        Alpine.store('ui').toast('Failed to load track metadata', 'error');
        this.close();
      } finally {
        this.isLoading = false;
      }
    },

    close() {
      this.isOpen = false;
      this.tracks = [];
      this.library = null;
      this.mixedFields = new Set();
      this.navigationEnabled = false;
      this.currentTrackId = null;
      this._batchTrackIds = [];
      this._batchOrderedIds = [];
      this._sessionId = null;
      this.$store.ui.closeModal();
    },

    getTrackPath(track) {
      return track?.path || track?.filepath;
    },

    async loadMetadata() {
      if (this.tracks.length === 0) {
        throw new Error('No tracks to edit');
      }

      if (this.isBatchEdit) {
        await this.loadBatchMetadata();
      } else {
        await this.loadSingleMetadata();
      }

      this.originalMetadata = { ...this.metadata };
    },

    async loadSingleMetadata() {
      this.mixedFields = new Set();

      const track = this.tracks[0];
      const trackPath = this.getTrackPath(track);

      if (!trackPath) {
        throw new Error('No track path available');
      }

      if (!window.__TAURI__) {
        this.metadata = {
          title: track.title || '',
          artist: track.artist || '',
          album: track.album || '',
          album_artist: track.album_artist || '',
          track_number: track.track_number?.toString() || '',
          track_total: '',
          disc_number: track.disc_number?.toString() || '',
          disc_total: '',
          year: track.year?.toString() || '',
          genre: track.genre || '',
        };
        this.fileInfo = {
          format: 'Unknown',
          duration: formatDuration(track.duration),
          bitrate: '—',
          sample_rate: '—',
          channels: '—',
          path: trackPath,
        };
        return;
      }

      const { invoke } = window.__TAURI__.core;
      const data = await invoke('get_track_metadata', { path: trackPath });

      this.metadata = {
        title: data.title || '',
        artist: data.artist || '',
        album: data.album || '',
        album_artist: data.album_artist || '',
        track_number: data.track_number?.toString() || '',
        track_total: data.track_total?.toString() || '',
        disc_number: data.disc_number?.toString() || '',
        disc_total: data.disc_total?.toString() || '',
        year: data.year?.toString() || '',
        genre: data.genre || '',
      };

      this.fileInfo = {
        format: data.format || 'Unknown',
        duration: formatDuration(data.duration_ms ? data.duration_ms / 1000 : 0),
        bitrate: data.bitrate ? `${data.bitrate} kbps` : '—',
        sample_rate: data.sample_rate ? `${data.sample_rate} Hz` : '—',
        channels: data.channels
          ? (data.channels === 1 ? 'Mono' : data.channels === 2 ? 'Stereo' : `${data.channels} ch`)
          : '—',
        path: data.path || '',
      };
    },

    async loadBatchMetadata() {
      const fields = [
        'title',
        'artist',
        'album',
        'album_artist',
        'track_number',
        'track_total',
        'disc_number',
        'disc_total',
        'year',
        'genre',
      ];

      const paths = this.tracks
        .map((t) => this.getTrackPath(t))
        .filter(Boolean);

      let allMetadata;

      if (!window.__TAURI__) {
        allMetadata = this.tracks.map((track) => ({
          title: track.title || '',
          artist: track.artist || '',
          album: track.album || '',
          album_artist: track.album_artist || '',
          track_number: track.track_number?.toString() || '',
          track_total: '',
          disc_number: track.disc_number?.toString() || '',
          disc_total: '',
          year: track.year?.toString() || '',
          genre: track.genre || '',
        }));
      } else {
        const { invoke } = window.__TAURI__.core;
        const results = await invoke('get_tracks_metadata_batch', { paths });
        allMetadata = results.map((data) => ({
          title: data.title || '',
          artist: data.artist || '',
          album: data.album || '',
          album_artist: data.album_artist || '',
          track_number: data.track_number?.toString() || '',
          track_total: data.track_total?.toString() || '',
          disc_number: data.disc_number?.toString() || '',
          disc_total: data.disc_total?.toString() || '',
          year: data.year?.toString() || '',
          genre: data.genre || '',
        }));
      }

      const mergedMetadata = {};
      for (const field of fields) {
        const values = allMetadata.map((m) => m[field]);
        const uniqueValues = [...new Set(values)];
        if (uniqueValues.length === 1) {
          mergedMetadata[field] = uniqueValues[0];
        } else {
          mergedMetadata[field] = '';
          this.mixedFields.add(field);
        }
      }

      this.metadata = mergedMetadata;

      const totalDuration = this.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
      this.fileInfo = {
        format: 'Multiple',
        duration: formatDuration(totalDuration),
        bitrate: '—',
        sample_rate: '—',
        channels: '—',
        path: `${this.tracks.length} files selected`,
      };
    },

    isMixedField(field) {
      return this.mixedFields.has(field);
    },

    getPlaceholder(field) {
      if (this.isMixedField(field)) {
        return 'Multiple values';
      }
      return '';
    },

    hasFieldChanged(field) {
      return this.metadata[field] !== this.originalMetadata[field];
    },

    _getChangedFields() {
      const allFields = [
        'title',
        'artist',
        'album',
        'album_artist',
        'track_number',
        'track_total',
        'disc_number',
        'disc_total',
        'year',
        'genre',
      ];
      const changed = {};
      for (const field of allFields) {
        if (this.hasFieldChanged(field)) {
          changed[field] = {
            from: this.originalMetadata[field],
            to: this.metadata[field],
          };
        }
      }
      return changed;
    },

    async saveCurrentEdits({ close = true, silent = false }) {
      if (!window.__TAURI__) {
        if (!silent) Alpine.store('ui').toast('Cannot save: Tauri not available', 'error');
        return false;
      }

      if (!this.hasUnsavedChanges) {
        if (close) this.close();
        return true;
      }

      this.isSaving = true;

      try {
        const { invoke } = window.__TAURI__.core;

        const updates = [];
        for (const track of this.tracks) {
          const trackPath = this.getTrackPath(track);
          if (!trackPath) continue;

          const update = { path: trackPath };
          let hasChanges = false;

          const fields = ['title', 'artist', 'album', 'album_artist', 'genre'];
          for (const field of fields) {
            if (this.hasFieldChanged(field)) {
              update[field] = this.metadata[field] || null;
              hasChanges = true;
            }
          }

          const intFields = ['track_number', 'track_total', 'disc_number', 'disc_total', 'year'];
          for (const field of intFields) {
            if (this.hasFieldChanged(field)) {
              update[field] = this.metadata[field] ? parseInt(this.metadata[field], 10) : null;
              hasChanges = true;
            }
          }

          if (hasChanges) {
            updates.push({ track, update });
          }
        }

        if (updates.length > 0) {
          await Promise.all(
            updates.map(({ update }) => invoke('save_track_metadata', { update })),
          );

          if (!silent) {
            const msg = updates.length === 1
              ? 'Metadata saved successfully'
              : `Metadata saved for ${updates.length} tracks`;
            Alpine.store('ui').toast(msg, 'success');
          }

          if (this.library) {
            await Promise.all(
              updates.map(({ track }) => this.library.rescanTrack(track.id)),
            );
          }
        }

        this.originalMetadata = { ...this.metadata };

        if (close) this.close();
        return true;
      } catch (error) {
        console.error('[metadata] Failed to save metadata:', error);
        Alpine.store('ui').toast(`Failed to save: ${error}`, 'error');
        return false;
      } finally {
        this.isSaving = false;
      }
    },

    async save() {
      await this.saveCurrentEdits({ close: true, silent: false });
    },

    async navigate(delta) {
      if (!this.navigationEnabled || this.isSaving || this.isLoading) {
        return;
      }

      if (this._batchOrderedIds.length < 2) {
        return;
      }

      const currentIdx = this.currentBatchIndex;
      let newIdx;

      if (currentIdx < 0) {
        newIdx = delta > 0 ? this._batchOrderedIds.length - 1 : 0;
      } else {
        newIdx = currentIdx + delta;
        if (newIdx < 0) {
          newIdx = this._batchOrderedIds.length - 1;
        } else if (newIdx >= this._batchOrderedIds.length) {
          newIdx = 0;
        }
      }

      const newTrackId = this._batchOrderedIds[newIdx];
      const newTrack = this.libraryTracks.find((t) => t.id === newTrackId);

      if (!newTrack) {
        return;
      }

      const saved = await this.saveCurrentEdits({ close: false, silent: true });
      if (!saved && this.hasUnsavedChanges) {
        return;
      }

      const libraryIndex = this.libraryTracks.findIndex((t) => t.id === newTrackId);
      this.updateLibrarySelection(newTrackId, libraryIndex);

      this.tracks = [newTrack];
      this.currentTrackId = newTrackId;
      this.mixedFields = new Set();

      this.isLoading = true;
      try {
        await this.loadSingleMetadata();
        this.originalMetadata = { ...this.metadata };
      } catch (error) {
        console.error('[metadata] Failed to load metadata for navigation:', error);
        Alpine.store('ui').toast('Failed to load track metadata', 'error');
      } finally {
        this.isLoading = false;
      }
    },

    updateLibrarySelection(trackId, index) {
      const browserEl = document.querySelector('[x-data="libraryBrowser"]');
      if (!browserEl) return;

      const browser = window.Alpine.$data(browserEl);
      if (!browser) return;

      browser.selectedTracks.clear();
      browser.selectedTracks.add(trackId);
      browser.lastSelectedIndex = index;

      if (typeof browser.scrollToTrack === 'function') {
        browser.scrollToTrack(trackId);
      }
    },

    navigatePrev() {
      this.navigate(-1);
    },

    navigateNext() {
      this.navigate(1);
    },

    handleKeydown(event) {
      if (event.key === 'Escape') {
        this.close();
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        this.save();
      } else if (event.key === 'ArrowLeft' && this.navigationEnabled) {
        event.preventDefault();
        this.navigatePrev();
      } else if (event.key === 'ArrowRight' && this.navigationEnabled) {
        event.preventDefault();
        this.navigateNext();
      }
    },
  }));
}
