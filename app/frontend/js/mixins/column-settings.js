import {
  DEFAULT_COLUMN_ORDER,
  DEFAULT_COLUMN_VISIBILITY,
  DEFAULT_COLUMN_WIDTHS,
} from '../constants.js';

/**
 * Column settings mixin for library browser.
 * Handles column visibility, ordering, settings persistence, and header context menu.
 */
export function columnSettingsMixin() {
  return {
    // State
    columnVisibility: { ...DEFAULT_COLUMN_VISIBILITY },
    columnOrder: [...DEFAULT_COLUMN_ORDER],

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

    isColumnVisible(key) {
      return this.columnVisibility[key] !== false;
    },

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

    async confirmResetColumnDefaults() {
      // Check if confirmation is disabled in settings
      const showConfirmation = window.settings?.initialized
        ? window.settings.get('columns:showResetConfirmation', true)
        : true;

      if (!showConfirmation) {
        // Skip confirmation - reset immediately
        this.resetColumnDefaults();
        this.$store.ui.toast('Column settings reset to defaults', 'success');
        return;
      }

      const message = 'Reset all column settings to defaults?\n\n' +
        '\u2022 Column widths\n\u2022 Column order\n\u2022 Column visibility\n\u2022 Sort settings';

      let confirmed = false;
      if (window.__TAURI__?.dialog?.confirm) {
        confirmed = await window.__TAURI__.dialog.confirm(message, {
          title: 'Reset Column Settings',
          kind: 'warning',
        });
      } else {
        confirmed = confirm(message);
      }

      if (confirmed) {
        this.resetColumnDefaults();
        this.$store.ui.toast('Column settings reset to defaults', 'success');
      }

      this.headerContextMenu = null;
    },

    showAllColumns() {
      for (const col of this.allColumns) {
        this.columnVisibility[col.key] = true;
      }
      this.saveColumnSettings();
      this.headerContextMenu = null;
    },
  };
}
