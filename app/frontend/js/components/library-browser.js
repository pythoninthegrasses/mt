import { playlists } from '../api/playlists.js';
import { formatDurationDash, formatRelativeTime } from '../utils/formatting.js';
import { isTypingInInput } from '../utils/dom.js';
import { typeToJumpMixin } from '../mixins/type-to-jump.js';
import { columnGeometryMixin } from '../mixins/column-geometry.js';
import { columnReorderMixin } from '../mixins/column-reorder.js';
import { columnSettingsMixin } from '../mixins/column-settings.js';
import { playlistDragMixin } from '../mixins/playlist-drag.js';
import { contextMenuActionsMixin } from '../mixins/context-menu-actions.js';
import { virtualScrollMixin } from '../mixins/virtual-scroll.js';
import { handleDoubleClickPlay, handleDoubleClickPlayQuery } from '../utils/queue-builder.js';

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
    _swrSnapshot: [],
    _swrGeneration: -1,
    ...playlistDragMixin(),

    ...columnGeometryMixin(),

    ...columnReorderMixin(),
    ...contextMenuActionsMixin(),

    ...typeToJumpMixin(),

    ...virtualScrollMixin(),

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

      // Force virtual scroll refresh when library view becomes visible
      // This fixes a rendering issue where tracks don't paint after returning
      // from another view (e.g., albums). Triggering a scroll event forces
      // both Alpine reactivity update and WebKit repaint.
      this.$watch('$store.ui.view', (view) => {
        if (view === 'library') {
          this.$nextTick(() => {
            const container = this.$refs.scrollContainer;
            if (container) {
              // Force scroll event to trigger _onScroll and repaint
              container.dispatchEvent(new Event('scroll'));
            }
          });
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
        const data = await playlists.getAll();
        this.playlists = Array.isArray(data) ? data : [];
      } catch (error) {
        console.error('Failed to load playlists:', error);
        this.playlists = [];
      }
    },

    get startIndex() {
      const trackCount = this.library.totalTracks;
      if (trackCount === 0) return 0;
      const scrollTop = Math.min(this._scrollTop, trackCount * this._rowHeight);
      return Math.max(0, Math.floor(scrollTop / this._rowHeight) - this._bufferRows);
    },

    get endIndex() {
      const trackCount = this.library.totalTracks;
      if (trackCount === 0) return 0;
      const scrollTop = Math.min(this._scrollTop, trackCount * this._rowHeight);
      const visibleRows = Math.ceil(this._containerHeight / this._rowHeight);
      return Math.min(
        trackCount,
        Math.floor(scrollTop / this._rowHeight) + visibleRows + this._bufferRows,
      );
    },

    get visibleTracks() {
      const lib = this.library;
      // Access _dataVersion to create Alpine reactive dependency on page loads
      void lib._dataVersion;
      const end = Math.min(this.endIndex, lib.totalTracks);
      const result = [];

      // Clear SWR snapshot when load generation changes (section switch, search, sort)
      if (lib._loadGeneration !== this._swrGeneration) {
        this._swrSnapshot = [];
        this._swrGeneration = lib._loadGeneration;
      }

      // Trigger page prefetch for visible range + 1 page ahead
      if (lib._isPaginated()) {
        const pageSize = lib._pageSize;
        const firstPage = Math.floor(this.startIndex / pageSize);
        const lastPage = Math.floor(Math.max(0, end - 1) / pageSize);
        // Prefetch 1 page ahead in scroll direction
        for (let p = firstPage; p <= lastPage + 1; p++) {
          lib._ensurePage(p);
        }
      }

      for (let i = this.startIndex; i < end; i++) {
        const track = lib.getTrackAtIndex(i);
        if (track) {
          result.push({ track, globalIndex: i });
        }
      }

      if (result.length > 0) {
        this._swrSnapshot = result;
        // Self-extinguish: clear jump flag once real data has arrived at the
        // target viewport. The $nextTick fallback in _jumpViaBackend also clears
        // it, but may fire before data is ready when totalTracks is transiently 0.
        this._isJumping = false;
        return result;
      }
      // During a backend jump, show shimmer rows in the target region instead of
      // stale content from the previous viewport. Use raw _scrollTop-based bounds
      // rather than startIndex/end because both collapse to 0 when totalTracks is
      // transiently 0 during a concurrent library reload, which would otherwise
      // cause a blank viewport for the full reload duration.
      if (this._isJumping) {
        const rowHeight = this._rowHeight;
        const visibleRows = Math.max(1, Math.ceil(this._containerHeight / rowHeight));
        const rawRow = Math.floor(this._scrollTop / rowHeight);
        const shimmerStart = Math.max(0, rawRow - this._bufferRows);
        const shimmerEnd = lib.totalTracks > 0
          ? Math.min(lib.totalTracks, rawRow + visibleRows + this._bufferRows)
          : rawRow + visibleRows;
        const placeholders = [];
        for (let i = shimmerStart; i < shimmerEnd; i++) {
          placeholders.push({ track: { _placeholder: true }, globalIndex: i });
        }
        return placeholders;
      }
      // Only reuse snapshot when its globalIndex range overlaps the current viewport.
      // Stale rows from a distant region would render off-screen (blank viewport).
      const snap = this._swrSnapshot;
      if (
        snap.length &&
        snap[snap.length - 1].globalIndex >= this.startIndex &&
        snap[0].globalIndex <= end - 1
      ) {
        return snap;
      }
      const placeholders = [];
      for (let i = this.startIndex; i < end; i++) {
        placeholders.push({ track: { _placeholder: true }, globalIndex: i });
      }
      return placeholders;
    },

    get totalContentHeight() {
      // During a jump while the library is transiently reporting totalTracks=0
      // (concurrent loadLibraryData reset), fall back to a viewport-sized height
      // so the row container does not collapse and hide shimmer placeholders.
      if (this._isJumping && this.library.totalTracks === 0) {
        const rowHeight = this._rowHeight;
        const visibleRows = Math.max(1, Math.ceil(this._containerHeight / rowHeight));
        const rawRow = Math.floor(this._scrollTop / rowHeight);
        return (rawRow + visibleRows + this._bufferRows) * rowHeight;
      }
      return this.library.totalTracks * this._rowHeight;
    },

    get offsetY() {
      // Match the shimmer branch in visibleTracks: when totalTracks=0 during a
      // jump, anchor offsetY to the raw scroll row so placeholders render at the
      // correct viewport position instead of collapsing to 0.
      if (this._isJumping && this.library.totalTracks === 0) {
        const rowHeight = this._rowHeight;
        const rawRow = Math.floor(this._scrollTop / rowHeight);
        const shimmerStart = Math.max(0, rawRow - this._bufferRows);
        return shimmerStart * rowHeight;
      }
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
    async handleRowClick(event, track, index) {
      if (event.shiftKey && this.lastSelectedIndex >= 0) {
        // Shift+click: range selection
        const start = Math.min(this.lastSelectedIndex, index);
        const end = Math.max(this.lastSelectedIndex, index);

        if (!event.ctrlKey && !event.metaKey) {
          this.selectedTracks.clear();
        }

        await this.library._loadPageRange(start, end);

        for (let i = start; i <= end; i++) {
          const t = this.library.getTrackAtIndex(i);
          if (!t) continue;
          if (!this.library.showRemote && this.library.isRemote(t)) continue;
          this.selectedTracks.add(t.id);
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
      if (this.library._isPaginated()) {
        const sortKeyMap = {
          default: 'artist',
          index: 'track_number',
          dateAdded: 'added_date',
          lastPlayed: 'last_played',
          playCount: 'play_count',
          year: 'date',
          genre: 'genre',
          trackTotal: 'track_total',
          discNumber: 'disc_number',
        };
        const uiStore = this.$store.ui;
        const queryParams = {
          search: this.library.searchQuery.trim() || null,
          sortBy: sortKeyMap[this.library.sortBy] || this.library.sortBy,
          sortOrder: this.library.sortOrder,
          ignoreWords: uiStore.sortIgnoreWords ? uiStore.sortIgnoreWordsList : null,
        };
        await handleDoubleClickPlayQuery(this, track, queryParams, 'library-browser');
      } else {
        await handleDoubleClickPlay(
          this,
          track,
          this.library.filteredTracks,
          index,
          'library-browser',
        );
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
    async selectAll() {
      if (this.library._isPaginated()) {
        await this.library._loadAllPages();
      }
      const total = this.library.totalTracks;
      for (let i = 0; i < total; i++) {
        const t = this.library.getTrackAtIndex(i);
        if (!t) continue;
        if (!this.library.showRemote && this.library.isRemote(t)) continue;
        this.selectedTracks.add(t.id);
      }
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

    // --- Template helper methods (extracted from inline expressions) ---

    getColumnPaddingClass(colKey) {
      if (colKey === 'status') return 'px-1';
      if (colKey === 'index') return 'px-2';
      if (colKey === 'duration') return 'pl-[3px] pr-[10px]';
      return 'px-4';
    },

    getColumnHeaderClasses(col, colIndex) {
      return [
        'column-header-cell',
        col.sortable ? 'cursor-grab' : '',
        this.library.sortBy === col.key ? 'column-header-active text-foreground' : '',
        colIndex < this.columns.length - 1 ? 'border-r border-border' : '',
        this.getColumnPaddingClass(col.key),
        this.isColumnDragging(col.key) ? 'dragging-column' : '',
        this.isOtherColumnDragging(col.key) ? 'other-dragging' : '',
        this.getColumnShiftDirection(colIndex) === 'left' ? 'shift-left' : '',
        this.getColumnShiftDirection(colIndex) === 'right' ? 'shift-right' : '',
      ];
    },

    getColumnHeaderStyle(col) {
      if (!this.isColumnDragging(col.key)) return '';
      return `transform:${this.getColumnDragTransform(col.key)}; z-index: 50;`;
    },

    handleColumnHeaderMousedown(col, event) {
      if (
        !event.target.closest('.column-resizer-left') &&
        !event.target.closest('.column-resizer-right')
      ) {
        this.startColumnDrag(col, event);
      }
    },

    handleColumnHeaderClick(col) {
      if (!this.draggingColumnKey && !this.wasResizing && !this.wasColumnDragging) {
        this.handleSort(col.key);
      }
    },

    getTrackRowStyle(item) {
      const base = `grid-template-columns: ${this.getGridTemplateColumns()};`;
      if (!this.isDraggingTrack(item.globalIndex)) return base;
      return `${base} transform: ${
        this.getTrackDragTransform(item.globalIndex)
      }; transition: none;`;
    },

    getTrackRowClasses(item) {
      const trackId = item.track.id;
      const idx = item.globalIndex;
      const isRemoteNotMissing = !item.track.missing && this.library.isRemote(item.track);
      return [
        this.isSelected(trackId)
          ? 'track-row-selected'
          : (idx % 2 === 0 ? 'track-row-even' : 'track-row-odd'),
        this.isPlaying(trackId) && !this.isSelected(trackId) ? 'track-row-playing' : '',
        !this.isSelected(trackId) && !this.isPlaying(trackId) ? 'hover:bg-muted/50' : '',
        this.isDraggingTrack(idx) ? 'bg-card shadow-lg z-10 relative' : '',
        this.isOtherTrackDragging(idx) ? 'opacity-50' : '',
        isRemoteNotMissing ? 'opacity-75' : '',
        this.getDragOverClass(idx),
      ];
    },

    getTrackCellClasses(col, item) {
      return [
        'py-1.5 overflow-hidden text-ellipsis whitespace-nowrap',
        this.getColumnPaddingClass(col.key),
        col.key !== 'title' && col.key !== 'status' && !this.isSelected(item.track.id)
          ? 'text-muted-foreground'
          : '',
      ];
    },

    getIndexDisplay(item) {
      return this.isInPlaylistView() ? (item.globalIndex + 1) : (item.track.track_number || '');
    },

    handleContextMenuItemClick(item) {
      if (!item.disabled && !item.hasSubmenu) {
        item.action();
        this.contextMenu = null;
      } else if (!item.disabled) {
        item.action();
      }
    },

    handleSubmenuMouseenter(item, el) {
      if (item.hasSubmenu) {
        this.showPlaylistSubmenu = true;
        this.submenuY = el.getBoundingClientRect().top;
        if (this.submenuCloseTimeout) {
          clearTimeout(this.submenuCloseTimeout);
          this.submenuCloseTimeout = null;
        }
      } else {
        this.showPlaylistSubmenu = false;
      }
    },

    handleSubmenuMouseleave(item) {
      if (item.hasSubmenu) {
        this.submenuCloseTimeout = setTimeout(() => {
          this.showPlaylistSubmenu = false;
        }, 150);
      }
    },

    getSubmenuStyle() {
      if (!this.contextMenu) return '';
      const left = this.submenuOnLeft ? this.contextMenu.x - 180 : this.contextMenu.x + 180 + 45;
      const maxHeight = window.innerHeight - this.submenuY - 10;
      return `left: ${left}px; top: ${this.submenuY}px; max-height: ${maxHeight}px; overflow-y: auto`;
    },
  }));
}

export default createLibraryBrowser;
