import {
  DEFAULT_COLUMN_WIDTHS,
  MIN_DURATION_WIDTH,
  MIN_OTHER_COLUMN_WIDTH,
  MIN_TITLE_WIDTH,
} from '../constants.js';
import { measureTextWidth } from '../utils/dom.js';

/**
 * Column geometry mixin for library browser.
 * Handles column widths, resize interactions, auto-fit, and width distribution.
 */
export function columnGeometryMixin() {
  return {
    // Resize state
    resizingColumn: null,
    resizingNeighbor: null,
    resizeStartX: 0,
    resizeStartWidth: 0,
    resizeNeighborStartWidth: 0,
    wasResizing: false,

    // Width state
    _baseColumnWidths: { ...DEFAULT_COLUMN_WIDTHS },
    columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
    containerWidth: 0,
    resizeObserver: null,
    _persistedWidths: { ...DEFAULT_COLUMN_WIDTHS },

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
      return this.columns
        .map((col) => {
          const width = this.columnWidths[col.key] || DEFAULT_COLUMN_WIDTHS[col.key] || 100;
          const minWidth = this.getMinWidth(col.key);
          return `${Math.max(width, minWidth)}px`;
        })
        .join(' ');
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
          const distributionTotal = distributionKeys.reduce(
            (sum, key) => sum + newWidths[key],
            0,
          );
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
        const textWidth = measureTextWidth(text, row);
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

    measureTextWidth,
  };
}
