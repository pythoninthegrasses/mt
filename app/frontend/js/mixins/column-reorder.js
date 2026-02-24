/**
 * Column reorder mixin for library browser.
 * Handles drag-and-drop reordering of column headers.
 */
export function columnReorderMixin() {
  return {
    // State
    draggingColumnKey: null,
    dragOverColumnIdx: null,
    columnDragX: 0,
    columnDragStartX: 0,
    wasColumnDragging: false,

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
          newOverIdx = rightIdx;
        }
      }

      // Check columns to the left - only if we haven't moved right
      if (newOverIdx === dragIdx) {
        const leftIdx = dragIdx - 1;
        if (leftIdx >= 0) {
          const rect = cells[leftIdx].getBoundingClientRect();
          const triggerX = rect.right - rect.width * edgeThreshold;
          if (x < triggerX) {
            newOverIdx = leftIdx;
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
  };
}
