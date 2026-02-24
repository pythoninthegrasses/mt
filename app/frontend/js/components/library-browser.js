import { api } from '../api.js';
import { formatDurationDash, formatRelativeTime } from '../utils/formatting.js';
import { isTypingInInput } from '../utils/dom.js';
import { typeToJumpMixin } from '../mixins/type-to-jump.js';
import { columnGeometryMixin } from '../mixins/column-geometry.js';
import { columnReorderMixin } from '../mixins/column-reorder.js';
import { columnSettingsMixin } from '../mixins/column-settings.js';
import { playlistDragMixin } from '../mixins/playlist-drag.js';
import { contextMenuActionsMixin } from '../mixins/context-menu-actions.js';
import { virtualScrollMixin } from '../mixins/virtual-scroll.js';

export function createLibraryBrowser(Alpine) {
  Alpine.data('libraryBrowser', () => ({
    selectedTracks: new Set(),
    lastSelectedIndex: -1,
    contextMenu: null,
    headerContextMenu: null,
    playlists: [],
    showPlaylistSubmenu: false,
    submenuOnLeft: false,
    submenuY: 0,
    submenuCloseTimeout: null,
    currentPlaylistId: null,
    ...playlistDragMixin(),

    ...columnGeometryMixin(),

    ...columnReorderMixin(),
    ...contextMenuActionsMixin(),

    ...typeToJumpMixin(),

    ...virtualScrollMixin(),

    // Queue build generation counter (cancels stale background builds)
    _buildQueueGeneration: 0,

    ...columnSettingsMixin(),

    // Base column definitions
    baseColumns: [
      { key: 'status', label: '', sortable: false, minWidth: 24, canHide: false },
      { key: 'index', label: '#', sortable: true, minWidth: 40, canHide: false },
      { key: 'title', label: 'Title', sortable: true, minWidth: 100, canHide: false },
      { key: 'artist', label: 'Artist', sortable: true, minWidth: 80, canHide: true },
      { key: 'album', label: 'Album', sortable: true, minWidth: 80, canHide: true },
      { key: 'year', label: 'Year', sortable: true, minWidth: 50, canHide: true },
      { key: 'genre', label: 'Genre', sortable: true, minWidth: 80, canHide: true },
      { key: 'trackTotal', label: 'Total', sortable: true, minWidth: 40, canHide: true },
      { key: 'discNumber', label: 'Disc', sortable: true, minWidth: 40, canHide: true },
    ],

    // Extra columns for dynamic playlists
    extraColumns: {
      recent: {
        key: 'lastPlayed',
        label: 'Last Played',
        sortable: true,
        minWidth: 80,
        canHide: true,
      },
      added: { key: 'dateAdded', label: 'Added', sortable: true, minWidth: 80, canHide: true },
      top25: { key: 'playCount', label: 'Plays', sortable: true, minWidth: 50, canHide: true },
    },

    getColumnDef(key) {
      const baseDef = this.baseColumns.find((c) => c.key === key);
      if (baseDef) return baseDef;

      for (const extra of Object.values(this.extraColumns)) {
        if (extra.key === key) return extra;
      }

      if (key === 'duration') {
        return { key: 'duration', label: 'Time', sortable: true, minWidth: 40, canHide: true };
      }
      return null;
    },

    get columns() {
      const section = this.library.currentSection;
      const availableKeys = new Set([
        'status',
        'index',
        'title',
        'artist',
        'album',
        'year',
        'genre',
        'trackTotal',
        'discNumber',
        'duration',
      ]);

      if (this.extraColumns[section]) {
        availableKeys.add(this.extraColumns[section].key);
      }

      return this.columnOrder
        .filter((key) => availableKeys.has(key) && this.columnVisibility[key] !== false)
        .map((key) => this.getColumnDef(key))
        .filter(Boolean);
    },

    get allColumns() {
      const section = this.library.currentSection;
      const availableKeys = new Set([
        'status',
        'index',
        'title',
        'artist',
        'album',
        'year',
        'genre',
        'trackTotal',
        'discNumber',
        'duration',
      ]);

      if (this.extraColumns[section]) {
        availableKeys.add(this.extraColumns[section].key);
      }

      return this.columnOrder
        .filter((key) => availableKeys.has(key))
        .map((key) => this.getColumnDef(key))
        .filter(Boolean);
    },

    // Get count of visible columns (for preventing hiding all)
    get visibleColumnCount() {
      return this.allColumns.filter((col) => this.columnVisibility[col.key] !== false).length;
    },

    init() {
      this._initColumnSettings();

      const libraryStore = this.$store.library;
      let initialSection = libraryStore.currentSection;

      if (window.settings?.initialized) {
        initialSection = window.settings.get('sidebar:activeSection', initialSection);
      } else {
        const legacySidebar = localStorage.getItem('mt:sidebar');
        if (legacySidebar) {
          try {
            const parsed = JSON.parse(legacySidebar);
            if (parsed?.activeSection) {
              initialSection = parsed.activeSection;
            }
          } catch (_e) {
            // Ignore malformed legacy sidebar storage
          }
        }
      }

      // Initialize current section from persisted playlist selection
      if (initialSection && initialSection.startsWith('playlist-')) {
        if (libraryStore.currentSection !== initialSection) {
          libraryStore.setSection(initialSection);
        }
        this.currentPlaylistId = parseInt(initialSection.replace('playlist-', ''), 10);
      }

      const shouldAutoLoadLibrary = !initialSection || initialSection === 'all';
      if (libraryStore.tracks.length === 0 && !libraryStore.loading && shouldAutoLoadLibrary) {
        this.$nextTick(() => {
          const hasSidebar = Boolean(document.querySelector('[data-testid="playlist-list"]'));
          if (hasSidebar) return;
          if (
            libraryStore.tracks.length === 0 &&
            !libraryStore.loading &&
            libraryStore.currentSection === 'all'
          ) {
            libraryStore.load();
          }
        });
      }

      this.loadPlaylists();

      this.$nextTick(() => {
        const container = this.$refs.scrollContainer;
        if (container) {
          this.containerWidth = container.clientWidth;
          requestAnimationFrame(() => {
            this.distributeExtraWidth();
          });

          // Debounce resize handler to prevent ResizeObserver loop errors
          let resizeTimeout;
          this.resizeObserver = new ResizeObserver(() => {
            if (resizeTimeout) {
              clearTimeout(resizeTimeout);
            }
            resizeTimeout = setTimeout(() => {
              // Use requestAnimationFrame to batch DOM reads/writes
              requestAnimationFrame(() => {
                this.containerWidth = container.clientWidth;
                this._containerHeight = container.clientHeight;
                this.distributeExtraWidth();
              });
            }, 100);
          });
          this.resizeObserver.observe(container);

          // Virtual scroll: track scroll position and container height
          this._containerHeight = container.clientHeight;
          container.addEventListener('scroll', () => this._onScroll(), { passive: true });
        }
      });

      document.addEventListener('click', (e) => {
        if (this.contextMenu && !e.target.closest('.context-menu')) {
          this.contextMenu = null;
          this.showPlaylistSubmenu = false;
        }
        if (this.headerContextMenu && !e.target.closest('.header-context-menu')) {
          this.headerContextMenu = null;
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (this.contextMenu) {
            this.contextMenu = null;
            this.showPlaylistSubmenu = false;
          }
          if (this.headerContextMenu) {
            this.headerContextMenu = null;
          }
        }
      });

      // Type-to-jump: listen for printable characters to jump to matching artist
      document.addEventListener('keydown', (e) => this.handleTypeToJump(e));

      document.addEventListener('mouseup', () => {
        if (this.resizingColumn) {
          this.finishColumnResize();
        }
      });

      document.addEventListener('mousemove', (e) => {
        if (this.resizingColumn) {
          this.handleColumnResize(e);
        }
      });

      this.$watch('$store.player.currentTrack', (newTrack) => {
        if (newTrack?.id) {
          this.scrollToTrack(newTrack.id);
        }
      });

      window.addEventListener('mt:scroll-to-current-track', () => {
        this.scrollToTrack(this.player.currentTrack?.id);
      });

      window.addEventListener('mt:queue-next-shortcut', () => {
        if (this.selectedTracks.size > 0) {
          this.playSelectedNext();
        }
      });

      window.addEventListener('mt:section-change', (e) => {
        this.clearSelection();
        const container = this.$refs.scrollContainer;
        if (container) {
          container.scrollTop = 0;
          this._scrollTop = 0;
        }
        const section = e.detail?.section || '';
        if (section.startsWith('playlist-')) {
          this.currentPlaylistId = parseInt(section.replace('playlist-', ''), 10);
        } else {
          this.currentPlaylistId = null;
        }
      });

      window.addEventListener('mt:playlists-updated', () => {
        this.loadPlaylists();
      });

      window.addEventListener('mt:column-settings-reset', () => {
        // Reload column settings from backend when reset from Settings page
        this._initColumnSettings();
        this.$nextTick(() => {
          this.distributeExtraWidth();
        });
      });
    },

    async loadPlaylists() {
      try {
        const data = await api.playlists.getAll();
        this.playlists = Array.isArray(data) ? data : [];
      } catch (error) {
        console.error('Failed to load playlists:', error);
        this.playlists = [];
      }
    },

    get startIndex() {
      const trackCount = this.library.filteredTracks.length;
      if (trackCount === 0) return 0;
      const scrollTop = Math.min(this._scrollTop, trackCount * this._rowHeight);
      return Math.max(0, Math.floor(scrollTop / this._rowHeight) - this._bufferRows);
    },

    get endIndex() {
      const trackCount = this.library.filteredTracks.length;
      if (trackCount === 0) return 0;
      const scrollTop = Math.min(this._scrollTop, trackCount * this._rowHeight);
      const visibleRows = Math.ceil(this._containerHeight / this._rowHeight);
      return Math.min(
        trackCount,
        Math.floor(scrollTop / this._rowHeight) + visibleRows + this._bufferRows,
      );
    },

    get visibleTracks() {
      const tracks = this.library.filteredTracks;
      const end = Math.min(this.endIndex, tracks.length);
      const result = [];
      for (let i = this.startIndex; i < end; i++) {
        result.push({ track: tracks[i], globalIndex: i });
      }
      return result;
    },

    get totalContentHeight() {
      return this.library.filteredTracks.length * this._rowHeight;
    },

    get offsetY() {
      return this.startIndex * this._rowHeight;
    },

    /**
     * Get the library store
     */
    get library() {
      return this.$store.library;
    },

    /**
     * Get the player store
     */
    get player() {
      return this.$store.player;
    },

    /**
     * Get the queue store
     */
    get queue() {
      return this.$store.queue;
    },

    /**
     * Get sort indicator for column
     * @param {string} key - Column key
     */
    getSortIndicator(key) {
      if (this.library.sortBy !== key) return '';
      return this.library.sortOrder === 'asc' ? '▲' : '▼';
    },

    handleSort(key) {
      // Don't sort if context menu is open (click should just close the menu)
      if (this.headerContextMenu) {
        this.headerContextMenu = null;
        return;
      }
      const col = this.allColumns.find((c) => c.key === key);
      if (!col?.sortable || this.wasResizing) {
        return;
      }
      this.library.setSortBy(key);
    },

    /**
     * Handle track row click
     * @param {Event} event - Click event
     * @param {Object} track - Track object
     * @param {number} index - Track index
     */
    handleRowClick(event, track, index) {
      if (event.shiftKey && this.lastSelectedIndex >= 0) {
        // Shift+click: range selection
        const start = Math.min(this.lastSelectedIndex, index);
        const end = Math.max(this.lastSelectedIndex, index);

        if (!event.ctrlKey && !event.metaKey) {
          this.selectedTracks.clear();
        }

        for (let i = start; i <= end; i++) {
          const t = this.library.filteredTracks[i];
          if (t) this.selectedTracks.add(t.id);
        }
      } else if (event.ctrlKey || event.metaKey) {
        // Ctrl/Cmd+click: toggle selection
        if (this.selectedTracks.has(track.id)) {
          this.selectedTracks.delete(track.id);
        } else {
          this.selectedTracks.add(track.id);
        }
        this.lastSelectedIndex = index;
      } else {
        // Regular click: single selection
        this.selectedTracks.clear();
        this.selectedTracks.add(track.id);
        this.lastSelectedIndex = index;
      }
    },

    async handleDoubleClick(track, index) {
      this.queue._updating = true;
      // Cancel any in-flight background queue build
      this._buildQueueGeneration++;
      const generation = this._buildQueueGeneration;
      let backgroundBuildStarted = false;

      try {
        if (this.queue.shuffle) {
          await this.queue.clear();
          await this.queue.add(this.library.filteredTracks, false);
          if (index >= 0 && index < this.queue.items.length) {
            this.queue.currentIndex = index;
            this.queue._shuffleItems();
            await this.queue._syncQueueToBackend();
            await this.queue.playIndex(0);
          } else {
            await this.player.playTrack(track);
          }
        } else if (index >= 0 && index < this.library.filteredTracks.length) {
          backgroundBuildStarted = true;

          // Preserve current track in history before replacing queue
          if (this.queue.currentIndex >= 0) {
            this.queue._pushToHistory(this.queue.currentIndex);
          }

          // Start playback immediately
          this.queue.items.splice(0, this.queue.items.length, track);
          this.queue._originalOrder.splice(0, this.queue._originalOrder.length, track);
          this.queue.currentIndex = 0;
          this.queue._playNextOffset = 0;
          await this.player.playTrack(track);

          // Build full queue in background
          const allTracks = this.library.filteredTracks;
          const buildQueue = async () => {
            try {
              await api.queue.clear();
              if (this._buildQueueGeneration !== generation) return;

              const subsequent = allTracks.slice(index);
              const preceding = allTracks.slice(0, index);
              const fullQueue = [...subsequent, ...preceding];

              if (this._buildQueueGeneration !== generation) return;

              this.queue.items.splice(0, this.queue.items.length, ...fullQueue);
              this.queue._originalOrder.splice(0, this.queue._originalOrder.length, ...fullQueue);
              this.queue.currentIndex = 0;

              const trackIds = fullQueue.map((t) => t.id);
              await api.queue.add(trackIds);
              if (this._buildQueueGeneration !== generation) return;

              await api.queue.setCurrentIndex(0);
            } catch (err) {
              if (this._buildQueueGeneration === generation) {
                console.error('[library-browser] Failed to build queue:', err);
              }
            } finally {
              if (this._buildQueueGeneration === generation) {
                setTimeout(() => {
                  this.queue._updating = false;
                }, 200);
              }
            }
          };
          buildQueue();
        } else {
          await this.player.playTrack(track);
        }
      } finally {
        if (!backgroundBuildStarted) {
          setTimeout(() => {
            this.queue._updating = false;
          }, 200);
        }
      }
    },

    /**
     * Check if track is selected
     * @param {string} trackId - Track ID
     */
    isSelected(trackId) {
      return this.selectedTracks.has(trackId);
    },

    /**
     * Check if track is currently playing
     * @param {string} trackId - Track ID
     */
    isPlaying(trackId) {
      return this.player.currentTrack?.id === trackId;
    },

    formatDuration: formatDurationDash,
    formatRelativeTime,

    /**
     * Clear selection
     */
    clearSelection() {
      this.selectedTracks.clear();
      this.lastSelectedIndex = -1;
    },

    /**
     * Select all tracks
     */
    selectAll() {
      this.library.filteredTracks.forEach((t) => this.selectedTracks.add(t.id));
    },

    isTypingInInput,

    /**
     * Handle keyboard shortcuts
     * @param {KeyboardEvent} event
     */
    handleKeydown(event) {
      // Suppress all library shortcuts when typing in inputs or when metadata modal is open
      if (this.isTypingInInput(event) || this.$store.ui.modal?.type === 'editMetadata') {
        return;
      }

      // Cmd/Ctrl+A: Select all
      if ((event.metaKey || event.ctrlKey) && event.key === 'a') {
        event.preventDefault();
        this.selectAll();
      }

      // Escape: Clear selection
      if (event.key === 'Escape') {
        this.clearSelection();
      }

      // Enter: Play selected
      if (event.key === 'Enter' && this.selectedTracks.size > 0) {
        this.playSelected();
      }

      const isDestructiveKey = event.key === 'Delete' || event.key === 'Backspace';
      if (isDestructiveKey && this.selectedTracks.size > 0) {
        event.preventDefault();
        if (this.isInPlaylistView()) {
          this.removeFromPlaylist();
        } else {
          this.removeSelected();
        }
      }
    },

    isInPlaylistView() {
      // Check the library store directly for reliability (avoids event timing issues)
      return this.$store.library.currentSection?.startsWith('playlist-') ||
        this.currentPlaylistId !== null;
    },
  }));
}

export default createLibraryBrowser;
