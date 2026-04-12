/**
 * Virtual scroll mixin for library browser.
 * Handles scroll tracking and scroll-to-track navigation.
 * Note: Computed getters (startIndex, endIndex, visibleTracks, totalContentHeight, offsetY)
 * stay in the main component since spread loses getter descriptors.
 */
export function virtualScrollMixin() {
  return {
    // State
    _rowHeight: 34,
    _scrollTop: 0,
    _containerHeight: 0,
    _bufferRows: 15,
    _rafId: null,

    _onScroll() {
      if (this._rafId) return;
      this._rafId = requestAnimationFrame(() => {
        const container = this.$refs.scrollContainer;
        if (container) {
          this._scrollTop = container.scrollTop;
          this._containerHeight = container.clientHeight;
        }
        this._rafId = null;
      });
    },

    scrollToTrack(trackId) {
      const lib = this.library;

      // For non-paginated sections, search the flat array directly
      if (!lib._isPaginated || !lib._isPaginated()) {
        const tracks = lib.filteredTracks;
        const idx = tracks.findIndex((t) => t.id === trackId);
        if (idx === -1) return;
        this._scrollToRowIndex(idx);
        return;
      }

      // For paginated sections, compute the global index from the page map
      for (const [pageIdx, page] of Object.entries(lib._trackPages)) {
        const localIdx = page.findIndex((t) => t.id === trackId);
        if (localIdx !== -1) {
          const globalIdx = parseInt(pageIdx, 10) * lib._pageSize + localIdx;
          this._scrollToRowIndex(globalIdx);
          return;
        }
      }
    },

    scrollToOffset(offset) {
      if (offset < 0 || offset >= this.library.totalTracks) return;
      this._scrollToRowIndex(offset);
    },

    _scrollToRowIndex(idx) {
      const container = this.$refs.scrollContainer;
      if (!container) return;
      const trackTop = idx * this._rowHeight;
      const headerEl = container.querySelector('[data-testid="library-header"]');
      const headerHeight = headerEl ? headerEl.offsetHeight : 0;
      const visibleHeight = container.clientHeight - headerHeight;
      const targetScroll = trackTop - visibleHeight / 2 + this._rowHeight / 2;
      container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
    },
  };
}
