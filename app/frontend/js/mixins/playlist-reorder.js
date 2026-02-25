/**
 * Playlist reorder mixin for sidebar drag-to-reorder functionality.
 * Handles mousedown → drag → drop reordering of playlists.
 *
 * Expects component to have: playlists, reorderDraggingIndex, reorderDragOverIndex,
 * reorderDragY, reorderDragStartY, ui, and api access via loadPlaylists().
 */
import { playlists } from '../api/playlists.js';

export function playlistReorderMixin() {
  return {
    startPlaylistReorder(index, event) {
      if (event.button !== 0) return;
      if (window._mtInternalDragActive || window._mtDragJustEnded) {
        console.log('[Sidebar] Ignoring mousedown - drag in progress or just ended');
        return;
      }

      const buttons = document.querySelectorAll('[data-playlist-reorder-index]');
      const draggedButton = buttons[index];
      const rect = draggedButton?.getBoundingClientRect();
      const startY = event.clientY || event.touches?.[0]?.clientY || 0;
      const startX = event.clientX || event.touches?.[0]?.clientX || 0;

      const DRAG_DELAY_MS = 150;
      const DRAG_DISTANCE_THRESHOLD = 5;

      let dragActivated = false;
      let delayTimer = null;

      const activateDrag = () => {
        if (dragActivated) return;
        dragActivated = true;
        window._mtPlaylistReorderActive = true;

        this.reorderDraggingIndex = index;
        this.reorderDragOverIndex = null;
        this.reorderDragY = startY;
        this.reorderDragStartY = rect ? rect.top + rect.height / 2 : startY;
      };

      const onMove = (e) => {
        const y = e.clientY || e.touches?.[0]?.clientY;
        const x = e.clientX || e.touches?.[0]?.clientX;
        if (y === undefined) return;

        if (!dragActivated) {
          const dx = x - startX;
          const dy = y - startY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance >= DRAG_DISTANCE_THRESHOLD) {
            if (delayTimer) {
              clearTimeout(delayTimer);
              delayTimer = null;
            }
            activateDrag();
          }
        }

        if (dragActivated) {
          this.reorderDragY = y;
          this.updatePlaylistReorderTarget(y);
        }
      };

      const onEnd = () => {
        if (delayTimer) {
          clearTimeout(delayTimer);
          delayTimer = null;
        }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);

        if (dragActivated) {
          this.finishPlaylistReorder();
          window._mtPlaylistReorderJustEnded = true;
          setTimeout(() => {
            window._mtPlaylistReorderJustEnded = false;
          }, 50);
        }
        window._mtPlaylistReorderActive = false;
      };

      delayTimer = setTimeout(() => {
        activateDrag();
      }, DRAG_DELAY_MS);

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onEnd);
    },

    updatePlaylistReorderTarget(y) {
      const buttons = document.querySelectorAll('[data-playlist-reorder-index]');
      let newOverIdx = null;

      for (let i = 0; i < buttons.length; i++) {
        if (i === this.reorderDraggingIndex) continue;
        const rect = buttons[i].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (y < midY) {
          newOverIdx = i;
          break;
        }
      }

      if (newOverIdx === null) {
        newOverIdx = this.playlists.length;
      }

      if (newOverIdx > this.reorderDraggingIndex) {
        newOverIdx = Math.min(newOverIdx, this.playlists.length);
      }

      this.reorderDragOverIndex = newOverIdx;
    },

    async finishPlaylistReorder() {
      if (
        this.reorderDraggingIndex !== null && this.reorderDragOverIndex !== null &&
        this.reorderDraggingIndex !== this.reorderDragOverIndex
      ) {
        let toPosition = this.reorderDragOverIndex;
        if (this.reorderDraggingIndex < toPosition) {
          toPosition--;
        }

        if (this.reorderDraggingIndex !== toPosition) {
          try {
            await playlists.reorderPlaylists(this.reorderDraggingIndex, toPosition);
            await this.loadPlaylists();
          } catch (error) {
            console.error('Failed to reorder playlists:', error);
            this.ui.toast('Failed to reorder playlists', 'error');
          }
        }
      }

      this.reorderDraggingIndex = null;
      this.reorderDragOverIndex = null;
    },

    getPlaylistReorderClass(index) {
      if (this.reorderDraggingIndex === null || this.reorderDragOverIndex === null) return '';
      if (index === this.reorderDraggingIndex) return '';

      if (this.reorderDraggingIndex < this.reorderDragOverIndex) {
        if (index > this.reorderDraggingIndex && index < this.reorderDragOverIndex) {
          return 'playlist-shift-up';
        }
      } else {
        if (index >= this.reorderDragOverIndex && index < this.reorderDraggingIndex) {
          return 'playlist-shift-down';
        }
      }
      return '';
    },

    isPlaylistDragging(index) {
      return this.reorderDraggingIndex === index;
    },

    isOtherPlaylistDragging(index) {
      return this.reorderDraggingIndex !== null && this.reorderDraggingIndex !== index;
    },

    getPlaylistDragTransform(index) {
      if (this.reorderDraggingIndex !== index) return '';

      const offsetY = this.reorderDragY - this.reorderDragStartY;
      return `translateY(${offsetY}px)`;
    },
  };
}
