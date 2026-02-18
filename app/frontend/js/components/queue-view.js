export function createQueueView(Alpine) {
  Alpine.data('queueView', () => ({
    // Virtual scroll state
    _rowHeight: 37,
    _scrollTop: 0,
    _containerHeight: 0,
    _bufferRows: 10,
    _rafId: null,
    _resizeObserver: null,

    init() {
      const container = this.$refs.queueScrollContainer;
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
        const container = this.$refs.queueScrollContainer;
        if (container) {
          this._scrollTop = container.scrollTop;
          this._containerHeight = container.clientHeight;
        }
        this._rafId = null;
      });
    },

    get queueStartIndex() {
      const tracks = this.$store.queue.tracks;
      if (tracks.length === 0) return 0;
      return Math.max(0, Math.floor(this._scrollTop / this._rowHeight) - this._bufferRows);
    },

    get queueEndIndex() {
      const tracks = this.$store.queue.tracks;
      if (tracks.length === 0) return 0;
      const visibleRows = Math.ceil(this._containerHeight / this._rowHeight);
      return Math.min(
        tracks.length,
        Math.floor(this._scrollTop / this._rowHeight) + visibleRows + this._bufferRows,
      );
    },

    get visibleQueueTracks() {
      const tracks = this.$store.queue.tracks;
      const end = Math.min(this.queueEndIndex, tracks.length);
      const result = [];
      for (let i = this.queueStartIndex; i < end; i++) {
        result.push({ track: tracks[i], index: i });
      }
      return result;
    },

    get queueTotalHeight() {
      return this.$store.queue.tracks.length * this._rowHeight;
    },

    get queueOffsetY() {
      return this.queueStartIndex * this._rowHeight;
    },
  }));
}

export default createQueueView;
