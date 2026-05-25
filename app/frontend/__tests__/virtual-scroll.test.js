/**
 * Unit tests for the virtual-scroll mixin.
 *
 * Regression coverage:
 *   - Blank viewport during smooth-scroll animation (TASK-349 follow-up).
 *     `_scrollToRowIndex` must use `behavior: 'auto'` so that the synchronous
 *     `this._scrollTop = container.scrollTop` mirror captures the destination
 *     position, not the pre-animation start position. Smooth scrolling on
 *     long-distance jumps in a 40k-track virtual list leaves the row container
 *     translated to the new offset while `container.scrollTop` is still
 *     animating from the old one, producing an empty viewport for the
 *     animation duration.
 */
import { describe, expect, it, vi } from 'vitest';
import { virtualScrollMixin } from '../js/mixins/virtual-scroll.js';

function createStub(
  { totalTracks = 40000, rowHeight = 34, clientHeight = 600, initialScrollTop = 0 } = {},
) {
  let scrollTop = initialScrollTop;
  const scrollTo = vi.fn((opts) => {
    // Mimic real DOM: with behavior 'auto', scrollTop updates synchronously;
    // with 'smooth', the value updates asynchronously (we leave it alone here
    // to surface any code that reads scrollTop synchronously expecting the
    // destination value).
    if (opts?.behavior !== 'smooth') {
      scrollTop = opts?.top ?? scrollTop;
    }
  });
  const container = {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(v) {
      scrollTop = v;
    },
    clientHeight,
    scrollTo,
    querySelector: () => null, // no header element
  };

  const stub = Object.assign(virtualScrollMixin(), {
    $refs: { scrollContainer: container },
    library: {
      totalTracks,
      _isPaginated: () => false,
    },
  });
  stub._rowHeight = rowHeight;
  return { stub, container, scrollTo };
}

describe('_scrollToRowIndex', () => {
  it('uses behavior: "auto" so the scrollTop mirror captures the destination', () => {
    const { stub, scrollTo } = createStub({ initialScrollTop: 0 });

    // Long-distance jump (row 39524 in a 40k library, like jumping to "Z").
    stub._scrollToRowIndex(39524, /* smooth */ true);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    const opts = scrollTo.mock.calls[0][0];
    // Regression: must not be 'smooth' — that left _scrollTop stuck at the
    // pre-animation value, leaving the row container translated offscreen.
    expect(opts.behavior).toBe('auto');
  });

  it('synchronizes _scrollTop with the destination after a long-distance jump', () => {
    const { stub } = createStub({ initialScrollTop: 0 });

    stub._scrollToRowIndex(39524, true);

    // With behavior: 'auto', container.scrollTop updates synchronously and the
    // line `this._scrollTop = container.scrollTop` captures the target.
    // The exact value depends on header height and viewport centering math;
    // what matters is that _scrollTop is in the target neighborhood, not 0.
    expect(stub._scrollTop).toBeGreaterThan(39524 * 34 - 600); // within one viewport of target row top
  });

  it('still synchronizes _scrollTop when called with smooth=false (existing scrollToOffset path)', () => {
    const { stub, scrollTo } = createStub({ initialScrollTop: 0 });

    stub._scrollToRowIndex(100, false);

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    expect(stub._scrollTop).toBeGreaterThan(0);
  });
});
