/**
 * Unit tests for the queue drag-reorder mixin.
 *
 * Covers the three pieces of logic that had no prior test coverage:
 *   1. reorder()             – index adjustment before delegating to store
 *   2. updateDropTarget()    – direction-aware dead zone during drag
 *   3. _finalizeDropTarget() – midpoint resolution on mouse release
 *   4. getShiftDirection()   – which items animate during drag
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { queueDragReorderMixin } from '../js/mixins/queue-drag-reorder.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 41;

function makeTracks(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    title: `Track ${i}`,
    artist: `Artist ${i}`,
  }));
}

/**
 * Create a mixin instance wired to a lightweight mock store + container.
 *
 * containerTop  – getBoundingClientRect().top for the queue list element
 * scrollTop     – current scroll position of the container
 * currentIndex  – which track is currently playing
 */
function createMixin({
  items = makeTracks(10),
  currentIndex = 0,
  containerTop = 0,
  scrollTop = 0,
} = {}) {
  const queueReorder = vi.fn();

  const store = {
    items: [...items],
    currentIndex,
    get playOrderItems() {
      const result = [];
      for (let i = this.currentIndex >= 0 ? this.currentIndex : 0; i < this.items.length; i++) {
        result.push({
          track: this.items[i],
          originalIndex: i,
          isCurrentTrack: i === this.currentIndex,
          isUpcoming: i > this.currentIndex,
        });
      }
      return result;
    },
    reorder: queueReorder,
  };

  const container = {
    getBoundingClientRect: () => ({ top: containerTop, bottom: containerTop + 500 }),
    get scrollTop() { return scrollTop; },
    set scrollTop(v) { scrollTop = v; },
    scrollHeight: 1000,
    clientHeight: 500,
  };

  const mixin = {
    ...queueDragReorderMixin(),
    _rowHeight: ROW_HEIGHT,
    $store: { queue: store },
    $refs: { queueList: container },
  };

  return { mixin, queueReorder, store, container };
}

// Compute relativeY for a cursor at `viewportY` given containerTop and scrollTop.
function relY(viewportY, { containerTop = 0, scrollTop = 0 } = {}) {
  return viewportY - containerTop + scrollTop;
}

// Cursor Y that puts the pointer at `fraction` (0–1) through row `rowIdx`.
function yAt(rowIdx, fraction, { containerTop = 0, scrollTop = 0 } = {}) {
  const relativeY = rowIdx * ROW_HEIGHT + fraction * ROW_HEIGHT;
  return relativeY + containerTop - scrollTop;
}

// ---------------------------------------------------------------------------
// 1. reorder() – index adjustment
// ---------------------------------------------------------------------------

describe('reorder', () => {
  it('adjusts toIdx down by 1 when moving forward (fromIdx < toIdx)', () => {
    const { mixin, queueReorder } = createMixin();
    mixin.reorder(2, 5);
    expect(queueReorder).toHaveBeenCalledWith(2, 4);
  });

  it('passes toIdx unchanged when moving backward (fromIdx > toIdx)', () => {
    const { mixin, queueReorder } = createMixin();
    mixin.reorder(5, 2);
    expect(queueReorder).toHaveBeenCalledWith(5, 2);
  });

  it('does nothing when adjustment makes fromIdx === toIdx', () => {
    // fromIdx=3, toIdx=4 → actualToIdx=3 → same position, no reorder
    const { mixin, queueReorder } = createMixin();
    mixin.reorder(3, 4);
    expect(queueReorder).not.toHaveBeenCalled();
  });

  it('does nothing when fromIdx === toIdx directly', () => {
    const { mixin, queueReorder } = createMixin();
    mixin.reorder(3, 3);
    expect(queueReorder).not.toHaveBeenCalled();
  });

  test.prop([
    fc.integer({ min: 0, max: 9 }),
    fc.integer({ min: 0, max: 9 }),
  ])('always calls store.reorder with valid indices or not at all', (from, to) => {
    const { mixin, queueReorder } = createMixin({ items: makeTracks(10) });
    mixin.reorder(from, to);

    if (queueReorder.mock.calls.length === 0) return; // early return path

    const [calledFrom, calledTo] = queueReorder.mock.calls[0];
    expect(calledFrom).toBeGreaterThanOrEqual(0);
    expect(calledTo).toBeGreaterThanOrEqual(0);
    expect(calledFrom).not.toBe(calledTo);
  });
});

// ---------------------------------------------------------------------------
// 2. updateDropTarget() – direction-aware dead zone
// ---------------------------------------------------------------------------

describe('updateDropTarget', () => {
  describe('initial snap (dragOverOriginalIdx === null)', () => {
    it('initializes using midpoint on first call', () => {
      const { mixin } = createMixin();
      mixin.draggingOriginalIdx = 0;
      // cursor at 60% through row 3 → midpoint rule → displayIdx 4 → originalIndex 4
      mixin.updateDropTarget(yAt(3, 0.6));
      expect(mixin.dragOverOriginalIdx).toBe(4);
    });

    it('initializes to current row when cursor is in top half', () => {
      const { mixin } = createMixin();
      mixin.draggingOriginalIdx = 0;
      // cursor at 30% through row 3 → midpoint rule → displayIdx 3 → originalIndex 3
      mixin.updateDropTarget(yAt(3, 0.3));
      expect(mixin.dragOverOriginalIdx).toBe(3);
    });
  });

  describe('direction-aware dead zone (after initial snap)', () => {
    it('does not update when cursor is in dead zone moving down', () => {
      const { mixin } = createMixin();
      mixin.draggingOriginalIdx = 0;
      mixin.dragOverOriginalIdx = 2; // already committed
      mixin._prevRelativeY = yAt(3, 0.4); // previous position

      // 50% is in the dead zone (35%–65%) when moving down
      mixin.updateDropTarget(yAt(3, 0.5));
      expect(mixin.dragOverOriginalIdx).toBe(2); // unchanged
    });

    it('does not update when cursor is in dead zone moving up', () => {
      const { mixin } = createMixin();
      mixin.draggingOriginalIdx = 0;
      mixin.dragOverOriginalIdx = 4;
      mixin._prevRelativeY = yAt(3, 0.6);

      // 50% is in the dead zone when moving up
      mixin.updateDropTarget(yAt(3, 0.5));
      expect(mixin.dragOverOriginalIdx).toBe(4); // unchanged
    });

    it('snaps when moving down and cursor enters bottom 35%', () => {
      const { mixin } = createMixin();
      mixin.draggingOriginalIdx = 0;
      mixin.dragOverOriginalIdx = 3;
      mixin._prevRelativeY = yAt(3, 0.5); // moving down

      // 70% > 65% threshold → snap to next gap
      mixin.updateDropTarget(yAt(3, 0.7));
      expect(mixin.dragOverOriginalIdx).toBe(4);
    });

    it('snaps when moving up and cursor enters top 35%', () => {
      const { mixin } = createMixin();
      mixin.draggingOriginalIdx = 9;
      mixin.dragOverOriginalIdx = 5;
      mixin._prevRelativeY = yAt(3, 0.5); // moving up

      // 30% < 35% (1 - 0.65) threshold → snap to this row
      mixin.updateDropTarget(yAt(3, 0.3));
      expect(mixin.dragOverOriginalIdx).toBe(3);
    });

    it('does not update when cursor is over the dragged item row', () => {
      const { mixin } = createMixin({ currentIndex: 0 });
      mixin.draggingOriginalIdx = 3;
      mixin.dragOverOriginalIdx = 5;
      mixin._prevRelativeY = yAt(3, 0.5);

      // cursor at top 30% of row 3 = dragged item's own row → early return
      mixin.updateDropTarget(yAt(3, 0.3));
      expect(mixin.dragOverOriginalIdx).toBe(5); // unchanged
    });
  });

  describe('edge cases', () => {
    it('clamps displayIdx to list end when cursor is below last item', () => {
      const { mixin } = createMixin({ items: makeTracks(5), currentIndex: 0 });
      mixin.draggingOriginalIdx = 0;
      // cursor well past the last row
      mixin.updateDropTarget(yAt(10, 0.9));
      // should target one past the last originalIndex
      expect(mixin.dragOverOriginalIdx).toBe(5); // originalIndex 4 + 1
    });

    it('does nothing when playOrderItems is empty', () => {
      const { mixin } = createMixin({ items: [], currentIndex: -1 });
      mixin.draggingOriginalIdx = 0;
      mixin.dragOverOriginalIdx = null;
      mixin.updateDropTarget(100);
      expect(mixin.dragOverOriginalIdx).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 3. _finalizeDropTarget() – midpoint rule on release (no dead zone)
// ---------------------------------------------------------------------------

describe('_finalizeDropTarget', () => {
  it('resolves using midpoint regardless of direction', () => {
    const { mixin } = createMixin();
    mixin.draggingOriginalIdx = 0;
    // cursor at exactly 55% through row 4 → midpoint → displayIdx 5 → originalIndex 5
    mixin._finalizeDropTarget(yAt(4, 0.55));
    expect(mixin.dragOverOriginalIdx).toBe(5);
  });

  it('resolves to current row when cursor is in top half', () => {
    const { mixin } = createMixin();
    mixin.draggingOriginalIdx = 0;
    mixin._finalizeDropTarget(yAt(4, 0.4));
    expect(mixin.dragOverOriginalIdx).toBe(4);
  });

  it('resolves when cursor is scrolled', () => {
    const { mixin } = createMixin({ scrollTop: 82 }); // scrolled 2 rows down
    mixin.draggingOriginalIdx = 0;
    // viewport y=0 → relativeY = 0 - 0 + 82 = 82 → row 2 (82/41=2), remainder=0 → displayIdx=2
    mixin._finalizeDropTarget(0);
    expect(mixin.dragOverOriginalIdx).toBe(2);
  });

  it('does not update when cursor is over the dragged item', () => {
    const { mixin } = createMixin({ currentIndex: 0 });
    mixin.draggingOriginalIdx = 3;
    mixin.dragOverOriginalIdx = 7; // previously committed
    // cursor at top of row 3 → displayIdx 3 → originalIndex 3 = draggingOriginalIdx
    mixin._finalizeDropTarget(yAt(3, 0.4));
    expect(mixin.dragOverOriginalIdx).toBe(7); // unchanged
  });

  test.prop([
    fc.integer({ min: 0, max: 9 }),  // dragging item
    fc.float({ min: 0, max: Math.fround(9.99) }), // row + fraction
  ])('always resolves to a valid originalIndex or leaves it unchanged', (dragIdx, rowFraction) => {
    const items = makeTracks(10);
    const { mixin } = createMixin({ items, currentIndex: 0 });
    mixin.draggingOriginalIdx = dragIdx;
    mixin.dragOverOriginalIdx = null;

    const rowIdx = Math.floor(rowFraction);
    const fraction = rowFraction - rowIdx;
    mixin._finalizeDropTarget(yAt(rowIdx, fraction));

    if (mixin.dragOverOriginalIdx !== null) {
      expect(mixin.dragOverOriginalIdx).toBeGreaterThanOrEqual(0);
      expect(mixin.dragOverOriginalIdx).toBeLessThanOrEqual(items.length);
      expect(mixin.dragOverOriginalIdx).not.toBe(dragIdx);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. getShiftDirection() – visual shift indicators
// ---------------------------------------------------------------------------

describe('getShiftDirection', () => {
  it('returns "none" when not dragging', () => {
    const { mixin } = createMixin();
    expect(mixin.getShiftDirection(3)).toBe('none');
  });

  it('returns "none" for the dragged item itself', () => {
    const { mixin } = createMixin();
    mixin.draggingOriginalIdx = 3;
    mixin.dragOverOriginalIdx = 7;
    expect(mixin.getShiftDirection(3)).toBe('none');
  });

  describe('dragging down (dragIdx < overIdx)', () => {
    it('shifts items between dragIdx and overIdx up', () => {
      const { mixin } = createMixin();
      mixin.draggingOriginalIdx = 2;
      mixin.dragOverOriginalIdx = 6;
      expect(mixin.getShiftDirection(3)).toBe('up');
      expect(mixin.getShiftDirection(4)).toBe('up');
      expect(mixin.getShiftDirection(5)).toBe('up');
    });

    it('does not shift items outside the range', () => {
      const { mixin } = createMixin();
      mixin.draggingOriginalIdx = 2;
      mixin.dragOverOriginalIdx = 6;
      expect(mixin.getShiftDirection(1)).toBe('none');
      expect(mixin.getShiftDirection(6)).toBe('none');
      expect(mixin.getShiftDirection(7)).toBe('none');
    });
  });

  describe('dragging up (dragIdx > overIdx)', () => {
    it('shifts items between overIdx and dragIdx down', () => {
      const { mixin } = createMixin();
      mixin.draggingOriginalIdx = 7;
      mixin.dragOverOriginalIdx = 3;
      expect(mixin.getShiftDirection(3)).toBe('down');
      expect(mixin.getShiftDirection(4)).toBe('down');
      expect(mixin.getShiftDirection(5)).toBe('down');
      expect(mixin.getShiftDirection(6)).toBe('down');
    });

    it('does not shift items outside the range', () => {
      const { mixin } = createMixin();
      mixin.draggingOriginalIdx = 7;
      mixin.dragOverOriginalIdx = 3;
      expect(mixin.getShiftDirection(2)).toBe('none');
      expect(mixin.getShiftDirection(7)).toBe('none');
      expect(mixin.getShiftDirection(8)).toBe('none');
    });
  });

  test.prop([
    fc.integer({ min: 0, max: 9 }), // dragIdx
    fc.integer({ min: 0, max: 9 }), // overIdx
    fc.integer({ min: 0, max: 9 }), // query item
  ])('dragged item never receives a shift direction', (dragIdx, overIdx, queryIdx) => {
    const { mixin } = createMixin();
    mixin.draggingOriginalIdx = dragIdx;
    mixin.dragOverOriginalIdx = overIdx;
    expect(mixin.getShiftDirection(dragIdx)).toBe('none');
  });

  test.prop([
    fc.integer({ min: 0, max: 9 }),
    fc.integer({ min: 0, max: 9 }),
    fc.integer({ min: 0, max: 9 }),
  ])('only "up" or "down" or "none" is ever returned', (dragIdx, overIdx, queryIdx) => {
    const { mixin } = createMixin();
    mixin.draggingOriginalIdx = dragIdx;
    mixin.dragOverOriginalIdx = overIdx;
    const dir = mixin.getShiftDirection(queryIdx);
    expect(['up', 'down', 'none']).toContain(dir);
  });
});
