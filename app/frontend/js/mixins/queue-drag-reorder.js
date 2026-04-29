/**
 * Queue Drag Reorder Mixin
 *
 * Handles drag-and-drop reordering of queue items in the Now Playing view.
 * Includes auto-scrolling near container edges and visual shift indicators.
 */
export function queueDragReorderMixin() {
  return {
    draggingOriginalIdx: null,
    dragOverOriginalIdx: null,
    scrollInterval: null,
    dragY: 0,
    dragStartY: 0,
    dragItemHeight: 0,
    _prevRelativeY: null,

    startDrag(originalIdx, event) {
      event.preventDefault();

      const target = event.currentTarget.closest('.queue-item');
      if (!target) return;

      const rect = target.getBoundingClientRect();
      this.dragItemHeight = rect.height;
      this.dragStartY = rect.top + rect.height / 2;
      this.dragY = event.clientY || event.touches?.[0]?.clientY || rect.top;

      this.draggingOriginalIdx = originalIdx;
      this.dragOverOriginalIdx = null;
      this._prevRelativeY = null;

      const container = this.$refs.queueList;

      const onMove = (e) => {
        const y = e.clientY || e.touches?.[0]?.clientY;
        if (y === undefined) return;

        this.dragY = y;
        this.handleAutoScroll(y, container);
        this.updateDropTarget(y);
      };

      const onEnd = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);

        this.stopAutoScroll();

        if (this.draggingOriginalIdx !== null) {
          // On release, recalculate drop target at exact cursor position using
          // standard midpoint (no dead zone) so placement matches where the user let go.
          this._finalizeDropTarget(this.dragY);

          if (
            this.dragOverOriginalIdx !== null &&
            this.draggingOriginalIdx !== this.dragOverOriginalIdx
          ) {
            this.reorder(this.draggingOriginalIdx, this.dragOverOriginalIdx);
          }
        }

        this.draggingOriginalIdx = null;
        this.dragOverOriginalIdx = null;
        this._prevRelativeY = null;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onEnd);
    },

    // Resolve drop position at exact cursor coordinates using standard midpoint.
    // Called on mouseup so the final placement is always accurate.
    _finalizeDropTarget(y) {
      const container = this.$refs.queueList;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const relativeY = y - containerRect.top + container.scrollTop;
      const playOrderItems = this.$store.queue.playOrderItems;
      if (playOrderItems.length === 0) return;

      const rawIdx = Math.floor(relativeY / this._rowHeight);
      const remainder = relativeY - rawIdx * this._rowHeight;
      let displayIdx = remainder > this._rowHeight / 2 ? rawIdx + 1 : rawIdx;
      displayIdx = Math.max(0, Math.min(displayIdx, playOrderItems.length));

      if (displayIdx >= playOrderItems.length) {
        const lastItem = playOrderItems[playOrderItems.length - 1];
        this.dragOverOriginalIdx = lastItem
          ? lastItem.originalIndex + 1
          : this.$store.queue.items.length;
      } else {
        const item = playOrderItems[displayIdx];
        if (item && item.originalIndex !== this.draggingOriginalIdx) {
          this.dragOverOriginalIdx = item.originalIndex;
        }
      }
    },

    // Update the drop target indicator during drag using a direction-aware dead zone.
    // Only snaps when cursor enters the outer 35% of a row in the direction of travel,
    // preventing visual jitter when hovering near a row boundary.
    updateDropTarget(y) {
      const container = this.$refs.queueList;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const relativeY = y - containerRect.top + container.scrollTop;

      const playOrderItems = this.$store.queue.playOrderItems;
      if (playOrderItems.length === 0) return;

      const rawIdx = Math.floor(relativeY / this._rowHeight);
      const remainder = relativeY - rawIdx * this._rowHeight;

      const prevRelY = this._prevRelativeY ?? relativeY;
      const movingDown = relativeY >= prevRelY;
      this._prevRelativeY = relativeY;

      // Snap only when cursor is in the outer 35% of a row in the drag direction.
      // The middle 30% is a dead zone — no indicator change — to prevent flickering.
      const snapPoint = this._rowHeight * 0.65;
      let displayIdx;
      if (movingDown && remainder > snapPoint) {
        displayIdx = rawIdx + 1;
      } else if (!movingDown && remainder < this._rowHeight - snapPoint) {
        displayIdx = rawIdx;
      } else if (this.dragOverOriginalIdx === null) {
        // No committed target yet: initialize using midpoint so indicator shows immediately.
        displayIdx = remainder > this._rowHeight / 2 ? rawIdx + 1 : rawIdx;
      } else {
        return;
      }

      displayIdx = Math.max(0, Math.min(displayIdx, playOrderItems.length));

      let newOverOriginalIdx = null;

      if (displayIdx >= playOrderItems.length) {
        const lastItem = playOrderItems[playOrderItems.length - 1];
        newOverOriginalIdx = lastItem ? lastItem.originalIndex + 1 : this.$store.queue.items.length;
      } else {
        const item = playOrderItems[displayIdx];
        if (item && item.originalIndex !== this.draggingOriginalIdx) {
          newOverOriginalIdx = item.originalIndex;
        } else {
          return;
        }
      }

      this.dragOverOriginalIdx = newOverOriginalIdx;
    },

    handleAutoScroll(y, container) {
      if (!container) {
        this.stopAutoScroll();
        return;
      }

      const rect = container.getBoundingClientRect();
      const scrollZone = 50;
      const scrollSpeed = 10;

      if (y < rect.top + scrollZone && container.scrollTop > 0) {
        this.startAutoScroll(container, -scrollSpeed, y);
      } else if (
        y > rect.bottom - scrollZone &&
        container.scrollTop < container.scrollHeight - container.clientHeight
      ) {
        this.startAutoScroll(container, scrollSpeed, y);
      } else {
        this.stopAutoScroll();
      }
    },

    startAutoScroll(container, speed, y) {
      if (this.scrollInterval) return;

      this.scrollInterval = setInterval(() => {
        container.scrollTop += speed;
        this.updateDropTarget(y);
      }, 16);
    },

    stopAutoScroll() {
      if (this.scrollInterval) {
        clearInterval(this.scrollInterval);
        this.scrollInterval = null;
      }
    },

    reorder(fromIdx, toIdx) {
      let actualToIdx = toIdx;
      if (fromIdx < toIdx) {
        actualToIdx = toIdx - 1;
      }

      if (fromIdx === actualToIdx) return;

      this.$store.queue.reorder(fromIdx, actualToIdx);
    },

    isDragging(originalIdx) {
      return this.draggingOriginalIdx === originalIdx;
    },

    isOtherDragging(originalIdx) {
      return this.draggingOriginalIdx !== null && this.draggingOriginalIdx !== originalIdx;
    },

    getShiftDirection(originalIdx) {
      if (this.draggingOriginalIdx === null || this.dragOverOriginalIdx === null) return 'none';
      if (originalIdx === this.draggingOriginalIdx) return 'none';

      const dragIdx = this.draggingOriginalIdx;
      const overIdx = this.dragOverOriginalIdx;

      if (dragIdx < overIdx) {
        if (originalIdx > dragIdx && originalIdx < overIdx) {
          return 'up';
        }
      } else {
        if (originalIdx >= overIdx && originalIdx < dragIdx) {
          return 'down';
        }
      }

      return 'none';
    },

    getDragTransform() {
      if (this.draggingOriginalIdx === null) return '';

      const offsetY = this.dragY - this.dragStartY;
      return `translateY(${offsetY}px)`;
    },
  };
}
