import { api } from '../api.js';

// Default column widths in pixels (all columns have explicit widths for grid layout)
const DEFAULT_COLUMN_WIDTHS = {
  status: 24, // Left gutter for status/drag handle
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

// Only Title and Time enforce minimum widths
const MIN_OTHER_COLUMN_WIDTH = 1;
const MIN_TITLE_WIDTH = 120;
const MIN_DURATION_WIDTH = 52; // Time column minimum

const DEFAULT_COLUMN_VISIBILITY = {
  status: true,
  index: true,
  title: true,
  artist: true,
  album: true,
  year: true, // Visible by default
  genre: false, // Hidden by default, toggleable
  trackTotal: false, // Hidden by default, toggleable
  discNumber: false, // Hidden by default, toggleable
  lastPlayed: true,
  dateAdded: true,
  playCount: true,
  duration: true,
};

const DEFAULT_COLUMN_ORDER = [
  'status',
  'index',
  'title',
  'artist',
  'album',
  'year', // Year before duration/Time
  'duration',
  'lastPlayed',
  'dateAdded',
  'playCount',
  'genre', // Hidden by default
  'trackTotal', // Hidden by default
  'discNumber', // Hidden by default
];

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
    draggingIndex: null,
    dragOverIndex: null,
    dragY: 0,
    dragStartY: 0,

    resizingColumn: null,
    resizingNeighbor: null,
    resizeStartX: 0,
    resizeStartWidth: 0,
    resizeNeighborStartWidth: 0,
    wasResizing: false,

    draggingColumnKey: null,
    dragOverColumnIdx: null,
    columnDragX: 0,
    columnDragStartX: 0,
    wasColumnDragging: false,

    containerWidth: 0,
    resizeObserver: null,

    _baseColumnWidths: { ...DEFAULT_COLUMN_WIDTHS },
    columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
    // Column settings (backed by Rust settings store)
    columnVisibility: { ...DEFAULT_COLUMN_VISIBILITY },
    columnOrder: [...DEFAULT_COLUMN_ORDER],
    _persistedWidths: { ...DEFAULT_COLUMN_WIDTHS },

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

    getColumnStyle(col) {
      const width = this.columnWidths[col.key] || DEFAULT_COLUMN_WIDTHS[col.key] || 100;
      const minWidth = this.getMinWidth(col.key);
      return `width: ${Math.max(width, minWidth)}px; min-width: ${minWidth}px;`;
    },

    getMinWidth(colKey) {
      if (colKey === 'title') return MIN_TITLE_WIDTH;
      if (colKey === 'duration') return MIN_DURATION_WIDTH;
      return MIN_OTHER_COLUMN_WIDTH;
    },

    getGridTemplateColumns() {
      return this.columns.map((col) => {
        const width = this.columnWidths[col.key] || DEFAULT_COLUMN_WIDTHS[col.key] || 100;
        const minWidth = this.getMinWidth(col.key);
        return `${Math.max(width, minWidth)}px`;
      }).join(' ');
    },

    getTotalColumnsWidth() {
      return this.columns.reduce((total, col) => {
        const width = this.columnWidths[col.key] || DEFAULT_COLUMN_WIDTHS[col.key] || 100;
        const minWidth = this.getMinWidth(col.key);
        return total + Math.max(width, minWidth);
      }, 0);
    },

    distributeExtraWidth() {
      if (this.resizingColumn) return;

      const container = this.$refs.scrollContainer;
      if (!container) return;

      const containerWidth = container.clientWidth;
      if (containerWidth <= 0) return;

      const baseWidths = this._baseColumnWidths || this.columnWidths;
      const newWidths = {};

      let totalBase = 0;
      this.columns.forEach((col) => {
        const base = baseWidths[col.key] || DEFAULT_COLUMN_WIDTHS[col.key] || 100;
        const minW = this.getMinWidth(col.key);
        newWidths[col.key] = Math.max(base, minW);
        totalBase += newWidths[col.key];
      });

      const difference = containerWidth - totalBase;

      if (difference > 0) {
        const distributionKeys = this.columns
          .filter((col) => ['title', 'artist', 'album'].includes(col.key))
          .map((col) => col.key);

        if (distributionKeys.length > 0) {
          const distributionTotal = distributionKeys.reduce((sum, key) => sum + newWidths[key], 0);
          let distributed = 0;

          distributionKeys.forEach((key, idx) => {
            const proportion = newWidths[key] / distributionTotal;
            let extra = Math.floor(proportion * difference);

            if (idx === distributionKeys.length - 1) {
              extra = difference - distributed;
            }

            newWidths[key] += extra;
            distributed += extra;
          });
        }
      } else if (difference < 0) {
        const shrinkable = this.columns
          .filter((col) => ['title', 'artist', 'album'].includes(col.key))
          .map((col) => col.key);

        if (shrinkable.length > 0) {
          const shrinkTotal = shrinkable.reduce((sum, key) => sum + newWidths[key], 0);
          let toShrink = Math.abs(difference);

          shrinkable.forEach((key, idx) => {
            const minW = this.getMinWidth(key);
            const available = newWidths[key] - minW;
            const proportion = newWidths[key] / shrinkTotal;
            let shrinkAmount = Math.min(Math.floor(proportion * toShrink), available);

            if (idx === shrinkable.length - 1) {
              shrinkAmount = Math.min(toShrink, available);
            }

            newWidths[key] -= shrinkAmount;
            toShrink -= shrinkAmount;
          });
        }
      }

      this.columnWidths = newWidths;
    },

    setBaseColumnWidth(key, width) {
      if (!this._baseColumnWidths) {
        this._baseColumnWidths = { ...this.columnWidths };
      }
      this._baseColumnWidths[key] = width;
    },

    isColumnVisible(key) {
      return this.columnVisibility[key] !== false;
    },

    // Toggle column visibility
    toggleColumnVisibility(key) {
      const col = this.allColumns.find((c) => c.key === key);
      if (!col || !col.canHide) return;

      // Count visible columns that can be hidden
      const visibleHideableCount = this.allColumns.filter(
        (c) => c.canHide && this.columnVisibility[c.key] !== false,
      ).length;

      // Prevent hiding if it's the last hideable visible column
      if (this.columnVisibility[key] !== false && visibleHideableCount <= 1) {
        return;
      }

      this.columnVisibility[key] = !this.columnVisibility[key];
      this.saveColumnSettings();
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
                this.distributeExtraWidth();
              });
            }, 100);
          });
          this.resizeObserver.observe(container);
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

      window.addEventListener('mt:section-change', (e) => {
        this.clearSelection();
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
    },

    _initColumnSettings() {
      // Load settings from backend
      if (window.settings && window.settings.initialized) {
        const savedVisibility = window.settings.get('library:columnVisibility', {});
        const savedOrder = window.settings.get('library:columnOrder', []);
        const savedWidths = window.settings.get('library:columnWidths', {});

        // Merge saved visibility with defaults (ensures new columns get default visibility)
        this.columnVisibility = { ...DEFAULT_COLUMN_VISIBILITY, ...savedVisibility };

        // Merge saved widths with defaults (ensures new columns get default widths)
        this._persistedWidths = { ...DEFAULT_COLUMN_WIDTHS, ...savedWidths };

        // Merge saved order with defaults (ensures new columns are added at correct positions)
        if (savedOrder.length > 0) {
          // Add any new columns from defaults that aren't in saved order
          const savedSet = new Set(savedOrder);
          const newOrder = [...savedOrder];
          DEFAULT_COLUMN_ORDER.forEach((col, idx) => {
            if (!savedSet.has(col)) {
              // Insert new column at its default position (or end if beyond saved length)
              const insertIdx = Math.min(idx, newOrder.length);
              newOrder.splice(insertIdx, 0, col);
            }
          });
          this.columnOrder = newOrder;
        } else {
          this.columnOrder = [...DEFAULT_COLUMN_ORDER];
        }

        console.log('[LibraryBrowser] Loaded column settings from backend');

        // Setup watchers to sync changes to backend
        // Using debounced watchers to avoid excessive IPC calls during rapid changes (e.g., resizing)
        this.$nextTick(() => {
          let visibilityTimeout;
          this.$watch('columnVisibility', (value) => {
            clearTimeout(visibilityTimeout);
            visibilityTimeout = setTimeout(() => {
              window.settings.set('library:columnVisibility', value).catch((err) =>
                console.error('[LibraryBrowser] Failed to sync columnVisibility:', err)
              );
            }, 500);
          });

          let orderTimeout;
          this.$watch('columnOrder', (value) => {
            clearTimeout(orderTimeout);
            orderTimeout = setTimeout(() => {
              window.settings.set('library:columnOrder', value).catch((err) =>
                console.error('[LibraryBrowser] Failed to sync columnOrder:', err)
              );
            }, 500);
          });

          let widthsTimeout;
          this.$watch('_persistedWidths', (value) => {
            clearTimeout(widthsTimeout);
            widthsTimeout = setTimeout(() => {
              window.settings.set('library:columnWidths', value).catch((err) =>
                console.error('[LibraryBrowser] Failed to sync columnWidths:', err)
              );
            }, 500);
          });
        });
      } else {
        console.log('[LibraryBrowser] Settings service not available, using defaults');
      }

      this._migrateOldColumnStorage();
      this._sanitizeColumnWidths();
    },

    _migrateOldColumnStorage() {
      const oldData = localStorage.getItem('mt:column-settings');
      if (oldData) {
        try {
          const data = JSON.parse(oldData);
          if (data.widths) {
            this._persistedWidths = { ...DEFAULT_COLUMN_WIDTHS, ...data.widths };
          }
          if (data.visibility) {
            this.columnVisibility = { ...DEFAULT_COLUMN_VISIBILITY, ...data.visibility };
          }
          if (data.order && Array.isArray(data.order)) {
            // Merge with defaults to add any new columns
            const savedSet = new Set(data.order);
            const newOrder = [...data.order];
            DEFAULT_COLUMN_ORDER.forEach((col, idx) => {
              if (!savedSet.has(col)) {
                const insertIdx = Math.min(idx, newOrder.length);
                newOrder.splice(insertIdx, 0, col);
              }
            });
            this.columnOrder = newOrder;
          }
          localStorage.removeItem('mt:column-settings');
        } catch (_e) {
          localStorage.removeItem('mt:column-settings');
        }
      }
    },

    _sanitizeColumnWidths() {
      const sanitizedWidths = { ...DEFAULT_COLUMN_WIDTHS };
      Object.keys(this._persistedWidths).forEach((key) => {
        const savedW = this._persistedWidths[key];
        const defaultW = DEFAULT_COLUMN_WIDTHS[key] || 100;
        const maxAllowed = defaultW * 5;
        sanitizedWidths[key] = Math.min(savedW, maxAllowed);
      });
      this._baseColumnWidths = sanitizedWidths;
      this.columnWidths = { ...this._baseColumnWidths };
    },

    saveColumnSettings() {
      this._persistedWidths = { ...(this._baseColumnWidths || this.columnWidths) };
    },

    startColumnResize(col, event) {
      event.preventDefault();
      event.stopPropagation();

      // Find the column index and its neighbor
      const colIndex = this.columns.findIndex((c) => c.key === col.key);
      const neighborIndex = colIndex + 1;
      const neighborCol = this.columns[neighborIndex];

      // Can't resize if there's no neighbor to trade width with
      if (!neighborCol) return;

      this.resizingColumn = col.key;
      this.resizingNeighbor = neighborCol.key;
      this.resizeStartX = event.clientX;
      this.resizeStartWidth = this.columnWidths[col.key] || DEFAULT_COLUMN_WIDTHS[col.key] || 100;
      this.resizeNeighborStartWidth = this.columnWidths[neighborCol.key] ||
        DEFAULT_COLUMN_WIDTHS[neighborCol.key] || 100;

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },

    handleColumnResize(event) {
      if (!this.resizingColumn || !this.resizingNeighbor) return;

      const delta = event.clientX - this.resizeStartX;

      // Get min widths for both columns
      const colMinWidth = this.getMinWidth(this.resizingColumn);
      const neighborMinWidth = this.getMinWidth(this.resizingNeighbor);

      // Calculate new widths - zero-sum trade between the two columns
      let newWidth = this.resizeStartWidth + delta;
      let newNeighborWidth = this.resizeNeighborStartWidth - delta;

      // Enforce minimum widths
      if (newWidth < colMinWidth) {
        newWidth = colMinWidth;
        newNeighborWidth = this.resizeStartWidth + this.resizeNeighborStartWidth - colMinWidth;
      }
      if (newNeighborWidth < neighborMinWidth) {
        newNeighborWidth = neighborMinWidth;
      }

      this.columnWidths[this.resizingColumn] = newWidth;
      this.columnWidths[this.resizingNeighbor] = newNeighborWidth;

      this.setBaseColumnWidth(this.resizingColumn, newWidth);
      this.setBaseColumnWidth(this.resizingNeighbor, newNeighborWidth);
    },

    finishColumnResize() {
      if (!this.resizingColumn) return;

      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // const wasResizingCol = this.resizingColumn;
      this.resizingColumn = null;
      this.resizingNeighbor = null;
      this.resizeNeighborStartWidth = 0;

      this.distributeExtraWidth();
      this.saveColumnSettings();

      this.wasResizing = true;
      setTimeout(() => {
        this.wasResizing = false;
      }, 100);
    },

    startColumnDrag(col, event) {
      if (this.resizingColumn) return;
      if (this.headerContextMenu) {
        this.headerContextMenu = null;
        return;
      }

      event.preventDefault();

      const header = document.querySelector('[data-testid="library-header"]');
      if (!header) return;

      const cells = header.querySelectorAll(':scope > div');
      const colIdx = this.columns.findIndex((c) => c.key === col.key);
      if (colIdx === -1 || !cells[colIdx]) return;

      const rect = cells[colIdx].getBoundingClientRect();
      const dragStartX = rect.left + rect.width / 2;
      const startX = event.clientX;
      let hasMoved = false;

      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';

      const onMove = (e) => {
        if (!hasMoved && Math.abs(e.clientX - startX) > 5) {
          hasMoved = true;
          this.draggingColumnKey = col.key;
          this.columnDragStartX = dragStartX;
          this.dragOverColumnIdx = null;
        }
        if (hasMoved) {
          this.columnDragX = e.clientX;
          this.updateColumnDropTarget(e.clientX);
        }
      };

      const onEnd = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (hasMoved) {
          this.finishColumnDrag(true);
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
    },

    updateColumnDropTarget(x) {
      const header = document.querySelector('[data-testid="library-header"]');
      if (!header) return;

      const cells = header.querySelectorAll(':scope > div');
      const dragIdx = this.columns.findIndex((c) => c.key === this.draggingColumnKey);
      let newOverIdx = dragIdx;

      const edgeThreshold = 0.05;

      // Check columns to the right - only swap with immediate neighbor
      const rightIdx = dragIdx + 1;
      if (rightIdx < cells.length) {
        const rect = cells[rightIdx].getBoundingClientRect();
        const triggerX = rect.left + rect.width * edgeThreshold;
        if (x > triggerX) {
          newOverIdx = rightIdx; // Swap with this column (not i+1)
        }
      }

      // Check columns to the left - only if we haven't moved right
      if (newOverIdx === dragIdx) {
        const leftIdx = dragIdx - 1;
        if (leftIdx >= 0) {
          const rect = cells[leftIdx].getBoundingClientRect();
          const triggerX = rect.right - rect.width * edgeThreshold;
          if (x < triggerX) {
            newOverIdx = leftIdx; // Swap with this column
          }
        }
      }

      this.dragOverColumnIdx = newOverIdx;
    },

    finishColumnDrag(hasMoved = false) {
      if (this.draggingColumnKey !== null && this.dragOverColumnIdx !== null) {
        const fromIdx = this.columns.findIndex((c) => c.key === this.draggingColumnKey);
        if (fromIdx !== -1 && fromIdx !== this.dragOverColumnIdx) {
          this.reorderColumnByIndex(fromIdx, this.dragOverColumnIdx);
        }
      }

      if (hasMoved) {
        this.wasColumnDragging = true;
        setTimeout(() => {
          this.wasColumnDragging = false;
        }, 100);
      }

      this.draggingColumnKey = null;
      this.dragOverColumnIdx = null;
      this.columnDragStartX = 0;
    },

    reorderColumnByIndex(fromIdx, toIdx) {
      const fromKey = this.columns[fromIdx]?.key;
      if (!fromKey) return;

      const visibleKeys = this.columns.map((c) => c.key);
      const targetKey = toIdx < visibleKeys.length
        ? visibleKeys[toIdx]
        : visibleKeys[visibleKeys.length - 1];

      const fromOrderIdx = this.columnOrder.indexOf(fromKey);
      const toOrderIdx = this.columnOrder.indexOf(targetKey);

      if (fromOrderIdx === -1 || toOrderIdx === -1) return;

      const newOrder = [...this.columnOrder];
      newOrder.splice(fromOrderIdx, 1);

      let insertIdx = toOrderIdx;
      if (fromOrderIdx < toOrderIdx) {
        insertIdx = toOrderIdx;
      }
      newOrder.splice(insertIdx, 0, fromKey);

      this.columnOrder = newOrder;
      this.saveColumnSettings();
    },

    isColumnDragging(key) {
      return this.draggingColumnKey === key;
    },

    isOtherColumnDragging(key) {
      return this.draggingColumnKey !== null && this.draggingColumnKey !== key;
    },

    getColumnShiftDirection(colIdx) {
      if (this.draggingColumnKey === null || this.dragOverColumnIdx === null) return 'none';

      const dragIdx = this.columns.findIndex((c) => c.key === this.draggingColumnKey);
      if (colIdx === dragIdx) return 'none';

      const overIdx = this.dragOverColumnIdx;

      if (dragIdx < overIdx) {
        if (colIdx > dragIdx && colIdx < overIdx) {
          return 'left';
        }
      } else {
        if (colIdx >= overIdx && colIdx < dragIdx) {
          return 'right';
        }
      }

      return 'none';
    },

    getColumnDragTransform(key) {
      if (this.draggingColumnKey !== key) return '';

      const offsetX = this.columnDragX - this.columnDragStartX;
      return `translateX(${offsetX}px)`;
    },

    autoFitColumn(col, event) {
      event.preventDefault();
      event.stopPropagation();

      const colIndex = this.columns.findIndex((c) => c.key === col.key);
      const neighborCol = this.columns[colIndex + 1];

      if (!neighborCol) return;

      const rows = document.querySelectorAll(`[data-column="${col.key}"]`);
      const minWidth = this.getMinWidth(col.key);
      let idealWidth = minWidth;

      rows.forEach((row) => {
        const text = (row.textContent || '').trim();
        const textWidth = this.measureTextWidth(text, row);
        const style = window.getComputedStyle(row);
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        idealWidth = Math.max(idealWidth, textWidth + padding);
      });

      const baseWidths = this._baseColumnWidths || this.columnWidths;
      const currentBaseWidth = baseWidths[col.key] || DEFAULT_COLUMN_WIDTHS[col.key] || 100;
      const neighborBaseWidth = baseWidths[neighborCol.key] ||
        DEFAULT_COLUMN_WIDTHS[neighborCol.key] || 100;
      const neighborMinWidth = this.getMinWidth(neighborCol.key);

      const maxExpansion = neighborBaseWidth - neighborMinWidth;
      const cappedIdealWidth = Math.min(idealWidth, currentBaseWidth + maxExpansion);

      const delta = cappedIdealWidth - currentBaseWidth;
      const newNeighborWidth = neighborBaseWidth - delta;

      this.setBaseColumnWidth(col.key, cappedIdealWidth);
      this.setBaseColumnWidth(neighborCol.key, newNeighborWidth);

      this.distributeExtraWidth();
      this.saveColumnSettings();
    },

    measureTextWidth(text, element) {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const style = window.getComputedStyle(element);
      context.font = `${style.fontSize} ${style.fontFamily}`;
      return context.measureText(text).width;
    },

    handleHeaderContextMenu(event) {
      event.preventDefault();

      const menuItems = this.allColumns
        .filter((col) => col.canHide)
        .map((col) => ({
          key: col.key,
          label: col.label,
          visible: this.columnVisibility[col.key] !== false,
          canToggle: this.columnVisibility[col.key] === false ||
            this.allColumns.filter((c) => c.canHide && this.columnVisibility[c.key] !== false)
                .length > 1,
        }));

      let x = event.clientX;
      let y = event.clientY;
      const menuWidth = 180;
      const menuHeight = menuItems.length * 32 + 16;

      if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 10;
      }
      if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 10;
      }

      this.headerContextMenu = { x, y, items: menuItems };
    },

    resetColumnDefaults() {
      this._baseColumnWidths = { ...DEFAULT_COLUMN_WIDTHS };
      this.columnWidths = { ...DEFAULT_COLUMN_WIDTHS };
      this.columnOrder = [...DEFAULT_COLUMN_ORDER];
      this.columnVisibility = { ...DEFAULT_COLUMN_VISIBILITY };
      this.library.sortBy = 'default';
      this.library.sortOrder = 'asc';
      this.library.applyFilters();
      this.distributeExtraWidth();
      this.saveColumnSettings();
      this.headerContextMenu = null;
    },

    showAllColumns() {
      for (const col of this.allColumns) {
        this.columnVisibility[col.key] = true;
      }
      this.saveColumnSettings();
      this.headerContextMenu = null;
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

    scrollToTrack(trackId) {
      this.$nextTick(() => {
        const trackRow = document.querySelector(`[data-track-id="${trackId}"]`);
        if (trackRow) {
          trackRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
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
      // Set flag to prevent backend events from overwriting our state during this operation
      this.queue._updating = true;

      try {
        await this.queue.clear();

        if (this.queue.shuffle) {
          // Shuffle enabled: Add all tracks, then shuffle with clicked track first
          await this.queue.add(this.library.filteredTracks, false);
          if (index >= 0 && index < this.queue.items.length) {
            this.queue.currentIndex = index;
            this.queue._shuffleItems();
            await this.queue._syncQueueToBackend();
            await this.queue.playIndex(0);
          } else {
            await this.player.playTrack(track);
          }
        } else {
          // Shuffle disabled: Play clicked track, then enqueue subsequent tracks
          if (index >= 0 && index < this.library.filteredTracks.length) {
            // Add clicked track first (will be currently playing)
            await this.queue.add([track], false);
            // Add subsequent tracks (what comes after in the view)
            if (index + 1 < this.library.filteredTracks.length) {
              const subsequentTracks = this.library.filteredTracks.slice(index + 1);
              await this.queue.add(subsequentTracks, false);
            }
            await this.queue.playIndex(0);
          } else {
            await this.player.playTrack(track);
          }
        }
      } finally {
        // Clear flag after a short delay to let any pending backend events pass
        setTimeout(() => {
          this.queue._updating = false;
        }, 200);
      }
    },

    handleTrackDragStart(event, track) {
      window._mtInternalDragActive = true;

      if (!this.selectedTracks.has(track.id)) {
        this.selectedTracks.clear();
        this.selectedTracks.add(track.id);
      }

      const trackIds = Array.from(this.selectedTracks);
      const trackIdsJson = JSON.stringify(trackIds);

      // Store track IDs globally for Tauri drop handler workaround
      window._mtDraggedTrackIds = trackIds;

      console.log('[drag-drop]', 'dragstart', {
        trackCount: trackIds.length,
        trackIds,
        dataTransferData: trackIdsJson,
      });

      event.dataTransfer.setData('application/json', trackIdsJson);
      event.dataTransfer.effectAllowed = 'all';

      const count = trackIds.length;
      const dragEl = document.createElement('div');
      dragEl.className =
        'fixed bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm font-medium shadow-lg pointer-events-none';
      dragEl.textContent = count === 1 ? '1 track' : `${count} tracks`;
      dragEl.style.position = 'absolute';
      dragEl.style.top = '-1000px';
      document.body.appendChild(dragEl);
      event.dataTransfer.setDragImage(dragEl, 0, 0);
      setTimeout(() => dragEl.remove(), 0);
    },

    handleTrackDragEnd(event) {
      window._mtInternalDragActive = false;
      window._mtDragJustEnded = true;
      setTimeout(() => {
        window._mtDragJustEnded = false;
        window._mtDraggedTrackIds = null;
        console.log('[drag-drop]', 'dragJustEnded cleared');
      }, 1000);

      console.log('[drag-drop]', 'dragend', {
        dropEffect: event.dataTransfer?.dropEffect,
      });
    },

    /**
     * Handle right-click context menu
     * @param {Event} event - Context menu event
     * @param {Object} track - Track object
     * @param {number} index - Track index
     */
    handleContextMenu(event, track, index) {
      event.preventDefault();

      // Select track if not already selected
      if (!this.selectedTracks.has(track.id)) {
        this.selectedTracks.clear();
        this.selectedTracks.add(track.id);
        this.lastSelectedIndex = index;
      }

      const selectedCount = this.selectedTracks.size;
      const trackLabel = selectedCount === 1 ? 'track' : `${selectedCount} tracks`;

      const isInPlaylist = this.currentPlaylistId !== null;

      const menuItems = [
        {
          label: 'Play Now',
          action: () => this.playSelected(),
        },
        {
          label: `Add ${trackLabel} to Queue`,
          action: () => this.addSelectedToQueue(),
        },
        { type: 'separator' },
        {
          label: 'Play Next',
          action: () => this.playSelectedNext(),
        },
        {
          label: 'Add to Playlist',
          hasSubmenu: true,
          action: () => {
            this.showPlaylistSubmenu = !this.showPlaylistSubmenu;
          },
        },
      ];

      if (isInPlaylist) {
        menuItems.push({ type: 'separator' });
        menuItems.push({
          label: `Remove ${trackLabel} from Playlist`,
          action: () => this.removeFromPlaylist(),
        });
      }

      menuItems.push({ type: 'separator' });
      menuItems.push({
        label: 'Show in Finder',
        action: () => this.showInFinder(track),
        disabled: selectedCount > 1,
      });
      menuItems.push({
        label: selectedCount > 1
          ? `Edit Metadata (${selectedCount} tracks)...`
          : 'Edit Metadata...',
        action: () => this.editMetadata(track),
      });
      menuItems.push({ type: 'separator' });
      menuItems.push({
        label: `Remove ${trackLabel} from Library`,
        action: () => this.removeSelected(),
        danger: true,
      });

      const menuHeight = 320;
      const menuWidth = 200;
      const submenuWidth = 200;
      // const submenuGap = 8;
      let x = event.clientX;
      let y = event.clientY;

      if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 10;
      }
      if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 10;
      }

      this.contextMenu = {
        x,
        y,
        track,
        items: menuItems,
      };
      this.showPlaylistSubmenu = false;
      this.submenuOnLeft = (x + menuWidth + 45 + submenuWidth) > window.innerWidth;
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

    /**
     * Get selected tracks
     */
    getSelectedTracks() {
      return this.library.filteredTracks.filter((t) => this.selectedTracks.has(t.id));
    },

    /**
     * Play selected tracks
     */
    async playSelected() {
      const tracks = this.getSelectedTracks();
      if (tracks.length > 0) {
        await this.queue.clear();
        await this.queue.addTracks(tracks);
        await this.queue.playIndex(0);
      }
      this.contextMenu = null;
    },

    /**
     * Add selected tracks to queue
     */
    async addSelectedToQueue() {
      const tracks = this.getSelectedTracks();
      if (tracks.length > 0) {
        console.log('[context-menu]', 'add_to_queue', {
          trackCount: tracks.length,
          trackIds: tracks.map((t) => t.id),
        });

        await this.queue.addTracks(tracks);
        this.$store.ui.toast(
          `Added ${tracks.length} track${tracks.length > 1 ? 's' : ''} to queue`,
          'success',
        );
      }
      this.contextMenu = null;
    },

    /**
     * Play selected tracks next
     */
    async playSelectedNext() {
      const tracks = this.getSelectedTracks();
      if (tracks.length > 0) {
        console.log('[context-menu]', 'play_next', {
          trackCount: tracks.length,
          trackIds: tracks.map((t) => t.id),
        });

        await this.queue.playNextTracks(tracks);
        this.$store.ui.toast(
          `Playing ${tracks.length} track${tracks.length > 1 ? 's' : ''} next`,
          'success',
        );
      }
      this.contextMenu = null;
    },

    async addToPlaylist(playlistId) {
      const tracks = this.getSelectedTracks();
      if (tracks.length === 0) return;

      console.log('[context-menu]', 'add_to_playlist', {
        playlistId,
        trackCount: tracks.length,
        trackIds: tracks.map((t) => t.id),
      });

      try {
        const trackIds = tracks.map((t) => t.id);
        const result = await api.playlists.addTracks(playlistId, trackIds);
        const playlist = this.playlists.find((p) => p.id === playlistId);
        const playlistName = playlist?.name || 'playlist';

        if (result.added > 0) {
          this.$store.ui.toast(
            `Added ${result.added} track${result.added > 1 ? 's' : ''} to "${playlistName}"`,
            'success',
          );
        } else {
          this.$store.ui.toast(
            `Track${tracks.length > 1 ? 's' : ''} already in "${playlistName}"`,
            'info',
          );
        }

        window.dispatchEvent(new CustomEvent('mt:playlists-updated'));
      } catch (error) {
        console.error('[context-menu]', 'add_to_playlist_error', {
          playlistId,
          error: error.message,
        });
        this.$store.ui.toast('Failed to add to playlist', 'error');
      }

      this.contextMenu = null;
      this.showPlaylistSubmenu = false;
    },

    async createPlaylistWithTracks() {
      const tracks = this.getSelectedTracks();
      if (tracks.length === 0) return;

      const name = prompt('Enter playlist name:');
      if (!name || !name.trim()) {
        this.contextMenu = null;
        this.showPlaylistSubmenu = false;
        return;
      }

      try {
        const playlist = await api.playlists.create(name.trim());
        const trackIds = tracks.map((t) => t.id);
        await api.playlists.addTracks(playlist.id, trackIds);

        this.$store.ui.toast(
          `Created "${name.trim()}" with ${tracks.length} track${tracks.length > 1 ? 's' : ''}`,
          'success',
        );
        window.dispatchEvent(new CustomEvent('mt:playlists-updated'));
      } catch (error) {
        console.error('Failed to create playlist:', error);
        this.$store.ui.toast('Failed to create playlist', 'error');
      }

      this.contextMenu = null;
      this.showPlaylistSubmenu = false;
    },

    async removeFromPlaylist() {
      if (!this.currentPlaylistId) return;

      const tracks = this.getSelectedTracks();
      if (tracks.length === 0) return;

      try {
        const positions = [];
        for (const track of tracks) {
          const index = this.library.filteredTracks.findIndex((t) => t.id === track.id);
          if (index >= 0) positions.push(index);
        }

        positions.sort((a, b) => b - a);

        for (const position of positions) {
          await api.playlists.removeTrack(this.currentPlaylistId, position);
        }

        this.$store.ui.toast(
          `Removed ${tracks.length} track${tracks.length > 1 ? 's' : ''} from playlist`,
          'success',
        );

        const playlist = await api.playlists.get(this.currentPlaylistId);
        const newTracks = (playlist.tracks || []).map((item) => item.track);
        this.library.tracks = newTracks;
        this.library.totalTracks = newTracks.length;
        this.library.totalDuration = newTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
        this.library.applyFilters();

        this.clearSelection();
        window.dispatchEvent(new CustomEvent('mt:playlists-updated'));
      } catch (error) {
        console.error('Failed to remove from playlist:', error);
        this.$store.ui.toast('Failed to remove from playlist', 'error');
      }

      this.contextMenu = null;
    },

    /**
     * Show track in Finder/file manager
     * @param {Object} track - Track object
     */
    async showInFinder(track) {
      const trackPath = track?.filepath || track?.path;
      if (!trackPath) {
        console.error('Cannot show in folder: track has no filepath/path', track);
        this.$store.ui.toast('Cannot locate file', 'error');
        this.contextMenu = null;
        return;
      }

      console.log('[context-menu]', 'show_in_finder', {
        trackId: track.id,
        trackTitle: track.title,
        trackPath,
      });

      try {
        if (window.__TAURI__) {
          const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
          await revealItemInDir(trackPath);
        } else {
          console.log('Show in folder (browser mode):', trackPath);
        }
      } catch (error) {
        console.error('[context-menu]', 'show_in_finder_error', {
          trackId: track.id,
          error: error.message,
        });
        this.$store.ui.toast('Failed to open folder', 'error');
      }
      this.contextMenu = null;
    },

    editMetadata(track) {
      const tracks = this.getSelectedTracks();
      if (tracks.length === 0) {
        tracks.push(track);
      }

      console.log('[context-menu]', 'edit_metadata', {
        trackCount: tracks.length,
        trackIds: tracks.map((t) => t.id),
        anchorTrackId: track.id,
      });

      this.contextMenu = null;
      this.$store.ui.openModal('editMetadata', {
        tracks,
        library: this.library,
        anchorTrackId: track.id,
      });
    },

    async removeSelected() {
      const tracks = this.getSelectedTracks();
      if (tracks.length === 0) return;

      console.log('[context-menu]', 'remove_from_library', {
        trackCount: tracks.length,
        trackIds: tracks.map((t) => t.id),
      });

      const confirmMsg = tracks.length === 1
        ? `Remove "${tracks[0].title}" from library?`
        : `Remove ${tracks.length} tracks from library?`;

      this.contextMenu = null;

      const confirmed = await window.__TAURI__?.dialog?.confirm(confirmMsg, {
        title: 'Remove from Library',
        kind: 'warning',
      }) ?? window.confirm(confirmMsg);

      if (confirmed) {
        for (const track of tracks) {
          await this.library.remove(track.id);
        }
        this.selectedTracks.clear();
        this.$store.ui.toast(
          `Removed ${tracks.length} track${tracks.length > 1 ? 's' : ''}`,
          'success',
        );
      }
    },

    formatDuration(seconds) {
      if (!seconds) return '--:--';
      const totalSeconds = Math.floor(seconds);
      const minutes = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    },

    formatRelativeTime(timestamp) {
      if (!timestamp) return '--';
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    },

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

    /**
     * Check if user is currently typing in an input field
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    isTypingInInput(event) {
      const tagName = event.target.tagName;
      return (
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT' ||
        event.target.isContentEditable
      );
    },

    /**
     * Handle keyboard shortcuts
     * @param {KeyboardEvent} event
     */
    handleKeydown(event) {
      // Suppress destructive shortcuts when typing in inputs or when metadata modal is open
      const isDestructiveKey = event.key === 'Delete' || event.key === 'Backspace';
      if (
        isDestructiveKey &&
        (this.isTypingInInput(event) || this.$store.ui.modal?.type === 'editMetadata')
      ) {
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
      return this.$store.library.currentSection?.startsWith('playlist-') || this.currentPlaylistId !== null;
    },

    startPlaylistDrag(index, event) {
      if (!this.isInPlaylistView()) return;
      event.preventDefault();

      const rows = document.querySelectorAll('[data-track-id]');
      const draggedRow = rows[index];
      const rect = draggedRow?.getBoundingClientRect();
      const startY = event.clientY || event.touches?.[0]?.clientY || 0;

      this.draggingIndex = index;
      this.dragOverIndex = null;
      this.dragY = startY;
      this.dragStartY = rect ? rect.top + rect.height / 2 : startY;

      const onMove = (e) => {
        const y = e.clientY || e.touches?.[0]?.clientY;
        if (y === undefined) return;
        this.dragY = y;
        this.updatePlaylistDragTarget(y);
      };

      const onEnd = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        this.finishPlaylistDrag();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onEnd);
    },

    updatePlaylistDragTarget(y) {
      const rows = document.querySelectorAll('[data-track-id]');
      let newOverIdx = null;

      for (let i = 0; i < rows.length; i++) {
        if (i === this.draggingIndex) continue;
        const rect = rows[i].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (y < midY) {
          newOverIdx = i;
          break;
        }
      }

      if (newOverIdx === null) {
        newOverIdx = this.library.filteredTracks.length;
      }

      if (newOverIdx > this.draggingIndex) {
        newOverIdx = Math.min(newOverIdx, this.library.filteredTracks.length);
      }

      this.dragOverIndex = newOverIdx;
    },

    async finishPlaylistDrag() {
      if (
        this.draggingIndex !== null && this.dragOverIndex !== null &&
        this.draggingIndex !== this.dragOverIndex
      ) {
        let toPosition = this.dragOverIndex;
        if (this.draggingIndex < toPosition) {
          toPosition--;
        }

        if (this.draggingIndex !== toPosition) {
          try {
            await api.playlists.reorder(this.currentPlaylistId, this.draggingIndex, toPosition);

            const playlist = await api.playlists.get(this.currentPlaylistId);
            const tracks = (playlist.tracks || []).map((item) => item.track);
            this.library.tracks = tracks;
            this.library.applyFilters();
          } catch (error) {
            console.error('[PlaylistDrag] Failed to reorder playlist:', error);
            this.$store.ui.toast('Failed to reorder tracks', 'error');
          }
        }
      }

      this.draggingIndex = null;
      this.dragOverIndex = null;
    },

    isDraggingTrack(index) {
      return this.draggingIndex === index;
    },

    isOtherTrackDragging(index) {
      return this.draggingIndex !== null && this.draggingIndex !== index;
    },

    getTrackDragTransform(index) {
      if (this.draggingIndex !== index) return '';

      const offsetY = this.dragY - this.dragStartY;
      return `translateY(${offsetY}px)`;
    },

    getDragOverClass(index) {
      if (this.draggingIndex === null || this.dragOverIndex === null) return '';
      if (index === this.draggingIndex) return '';

      const classes = [];

      // Add translation classes for items between drag source and target
      if (this.draggingIndex < this.dragOverIndex) {
        if (index > this.draggingIndex && index < this.dragOverIndex) {
          classes.push('translate-y-[-100%]');
        }
      } else {
        if (index >= this.dragOverIndex && index < this.draggingIndex) {
          classes.push('translate-y-[100%]');
        }
      }

      // Add drop indicator class (shows a line where the item will be inserted)
      // Only show if actual reorder would happen (i.e., adjusted position differs)
      let adjustedToPosition = this.dragOverIndex;
      if (this.draggingIndex < this.dragOverIndex) {
        adjustedToPosition = this.dragOverIndex - 1;
      }
      const wouldReorder = this.draggingIndex !== adjustedToPosition;

      // Show indicator ABOVE this row if dragOverIndex equals this row's index
      if (wouldReorder && index === this.dragOverIndex && this.dragOverIndex !== this.draggingIndex) {
        classes.push('playlist-drop-indicator-above');
      }
      // Show indicator BELOW the last row if dragging to the end
      const trackCount = this.library?.filteredTracks?.length || 0;
      if (wouldReorder && index === trackCount - 1 && this.dragOverIndex === trackCount) {
        classes.push('playlist-drop-indicator-below');
      }

      return classes.join(' ');
    },
  }));
}

export default createLibraryBrowser;
