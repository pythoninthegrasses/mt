import { queueDragReorderMixin } from '../mixins/queue-drag-reorder.js';

export function createNowPlayingView(Alpine) {
  Alpine.data('nowPlayingView', () => ({
    ...queueDragReorderMixin(),

    // Virtual scroll state
    _rowHeight: 41,
    _scrollTop: 0,
    _containerHeight: 0,
    _bufferRows: 10,
    _rafId: null,
    _resizeObserver: null,

    init() {
      const container = this.$refs.queueList;
      if (container) {
        this._containerHeight = container.clientHeight;
        container.addEventListener('scroll', () => this._onScroll(), { passive: true });

        this._resizeObserver = new ResizeObserver(() => {
          this._containerHeight = container.clientHeight;
        });
        this._resizeObserver.observe(container);
      }
    },

    destroy() {
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
    },

    _onScroll() {
      if (this._rafId) return;
      this._rafId = requestAnimationFrame(() => {
        const container = this.$refs.queueList;
        if (container) {
          this._scrollTop = container.scrollTop;
          this._containerHeight = container.clientHeight;
        }
        this._rafId = null;
      });
    },

    get queueStartIndex() {
      const items = this.$store.queue.playOrderItems;
      if (items.length === 0) return 0;
      return Math.max(0, Math.floor(this._scrollTop / this._rowHeight) - this._bufferRows);
    },

    get queueEndIndex() {
      const items = this.$store.queue.playOrderItems;
      if (items.length === 0) return 0;
      const visibleRows = Math.ceil(this._containerHeight / this._rowHeight);
      return Math.min(
        items.length,
        Math.floor(this._scrollTop / this._rowHeight) + visibleRows + this._bufferRows,
      );
    },

    get visibleQueueItems() {
      const items = this.$store.queue.playOrderItems;
      const end = Math.min(this.queueEndIndex, items.length);
      const result = [];
      for (let i = this.queueStartIndex; i < end; i++) {
        result.push({ ...items[i], displayIndex: i });
      }
      return result;
    },

    get queueTotalHeight() {
      return this.$store.queue.playOrderItems.length * this._rowHeight;
    },

    get queueOffsetY() {
      return this.queueStartIndex * this._rowHeight;
    },
  }));
}

export default createNowPlayingView;
