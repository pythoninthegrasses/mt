/**
 * Unit tests for the type-to-jump mixin.
 *
 * Covers:
 *   1. Buffer debounce timeout (should be 1500ms, not 500ms)
 *   2. _jumpViaBackend cancellation via generation counter
 *   3. Slow-typed multi-character prefix resolves to the correct artist
 *   4. jump_reliability_guard: keystroke coalescing, stale-response isolation,
 *      and the timeout fallback (flag off restores the synchronous path)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { typeToJumpMixin } from '../js/mixins/type-to-jump.js';
import { virtualScrollMixin } from '../js/mixins/virtual-scroll.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRACKS = [
  { id: 'dc-1', artist: 'Dry Cleaning', title: 'Scratchcard Lanyard' },
  { id: 'ddg-1', artist: 'Dum Dum Girls', title: 'Mine Tonight' },
  { id: 'ddg-2', artist: 'Dum Dum Girls', title: 'I Got Nothing' },
  { id: 'mw-1', artist: 'M. Ward', title: 'Fuel for Fire' },
];

function makeKey(char) {
  return {
    key: char,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: { tagName: 'DIV' },
  };
}

function createStub(tracks = TRACKS) {
  const libraryStub = {
    filteredTracks: tracks,
    _isPaginated: () => false,
    _allPagesLoaded: true,
    _pageSize: 500,
    _jumpToPrefix: vi.fn(),
    _fetchPage: vi.fn().mockResolvedValue(undefined),
    getTrackAtIndex: vi.fn(),
  };

  const stub = Object.assign(typeToJumpMixin(), {
    // Alpine provides $nextTick on real components; microtask delivery matches
    // how the jump-finalization callbacks are exercised here.
    $nextTick: (cb) => Promise.resolve().then(cb),
    $store: {
      ui: {
        view: 'library',
        typeToJumpActive: false,
        sortIgnoreWords: false,
        sortIgnoreWordsList: '',
      },
    },
    library: libraryStub,
    selectedTracks: new Set(),
    scrollToTrack: vi.fn(),
    scrollToOffset: vi.fn(),
    isTypingInInput: () => false,
  });

  return stub;
}

/**
 * Paginated stub whose backend lookup never resolves until asked to, so
 * supersession is exercised while jumps are still in flight. Guard on by
 * default; pass { guard: false } to keep the legacy synchronous path.
 */
function createSlowBackendStub({ guard = true } = {}) {
  const stub = createStub([]);
  stub.$nextTick = (cb) => cb();
  stub.jumpReliabilityGuard = () => guard;

  stub.library._isPaginated = () => true;
  stub.library._allPagesLoaded = false;

  const pending = [];
  stub.pendingJumps = pending;
  stub.library._jumpToPrefix = vi.fn().mockImplementation(() => {
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    const entry = { promise, resolve: (offset) => resolve(offset) };
    pending.push(entry);
    return promise;
  });
  stub.library._fetchPage = vi.fn().mockResolvedValue(undefined);
  stub.library.getTrackAtIndex = vi.fn().mockReturnValue(null);
  return stub;
}

// ---------------------------------------------------------------------------
// Tests: buffer debounce timeout
// ---------------------------------------------------------------------------

describe('type-to-jump: buffer timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('buffer survives 900ms between keystrokes and resolves to correct artist', async () => {
    const stub = createStub();

    // type "d"
    stub.handleTypeToJump(makeKey('d'));
    expect(stub.selectedTracks.has('dc-1')).toBe(true); // first d-artist: Dry Cleaning

    // 900ms later — should NOT expire the buffer (fix: 1500ms)
    await vi.advanceTimersByTimeAsync(900);

    // type "u" — buffer should now be "du"
    stub.handleTypeToJump(makeKey('u'));
    expect(stub.selectedTracks.has('ddg-1')).toBe(true); // Dum Dum Girls

    // 900ms later again
    await vi.advanceTimersByTimeAsync(900);

    // type "m" — buffer should now be "dum"
    stub.handleTypeToJump(makeKey('m'));
    // "dum" prefix matches "Dum Dum Girls", not "M. Ward"
    expect(stub.selectedTracks.has('ddg-1')).toBe(true);
    expect(stub.selectedTracks.has('mw-1')).toBe(false);
  });

  it('buffer expires after timeout and next keystroke is a fresh single-char jump', async () => {
    const stub = createStub();

    // type "d"
    stub.handleTypeToJump(makeKey('d'));
    expect(stub.selectedTracks.has('dc-1')).toBe(true);

    // Wait long enough for the buffer to clear (fix: 1500ms)
    await vi.advanceTimersByTimeAsync(1600);

    // buffer should now be empty; typing "m" is a fresh jump
    stub.handleTypeToJump(makeKey('m'));
    expect(stub.selectedTracks.has('mw-1')).toBe(true);
    expect(stub.selectedTracks.has('dc-1')).toBe(false);
  });

  it('buffer does NOT expire at 1400ms (remains within timeout window)', async () => {
    const stub = createStub();

    stub.handleTypeToJump(makeKey('d'));
    await vi.advanceTimersByTimeAsync(1400);

    // buffer still alive; "du" lands on Dum Dum Girls
    stub.handleTypeToJump(makeKey('u'));
    expect(stub.selectedTracks.has('ddg-1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: _jumpViaBackend cancellation
// ---------------------------------------------------------------------------

describe('type-to-jump: _jumpViaBackend cancellation', () => {
  it('stale backend response does not overwrite result from a newer call', async () => {
    // This test only exercises _jumpViaBackend, not handleTypeToJump.
    // Simulates: call #1 (prefix "d") fires first, then call #2 (prefix "du") fires.
    // Call #2 resolves first (fast), call #1 resolves second (slow).
    // Only call #2's scrollToOffset should be applied.
    const stub = createStub();

    // No matching tracks in filteredTracks so _jumpViaBackend is exercised
    stub.library.filteredTracks = [];
    stub.library._isPaginated = () => true;
    stub.library._allPagesLoaded = false;

    let resolveFirst;
    let resolveSecond;

    const firstPromise = new Promise((res) => {
      resolveFirst = () => res(0);
    });
    const secondPromise = new Promise((res) => {
      resolveSecond = () => res(100);
    });

    stub.library._jumpToPrefix
      .mockReturnValueOnce(firstPromise) // call #1 → offset 0
      .mockReturnValueOnce(secondPromise); // call #2 → offset 100

    // Fire both calls; neither has resolved yet
    const p1 = stub._jumpViaBackend('d');
    const p2 = stub._jumpViaBackend('du');

    // Resolve newer (second) call first
    resolveSecond();
    await p2;

    expect(stub.scrollToOffset).toHaveBeenCalledTimes(1);
    expect(stub.scrollToOffset).toHaveBeenCalledWith(100, expect.any(Number));

    // Now resolve the stale (first) call
    resolveFirst();
    await p1;

    // Should still be exactly one scroll — the stale call must not fire again
    expect(stub.scrollToOffset).toHaveBeenCalledTimes(1);
  });

  it('stale jump does not call _fetchPage after being superseded', async () => {
    // Ensures that a jump overtaken by a newer keystroke does not queue a page fetch.
    // The _ensurePage side-effect was removed from _jumpToPrefix; the only _fetchPage
    // call is gated behind the myGen check in _jumpViaBackend itself.
    const stub = createStub();
    stub.library.filteredTracks = [];
    stub.library._isPaginated = () => true;
    stub.library._allPagesLoaded = false;

    let resolveFirst;
    let resolveSecond;

    const firstPromise = new Promise((res) => {
      resolveFirst = () => res(0); // stale: offset 0 → page 0
    });
    const secondPromise = new Promise((res) => {
      resolveSecond = () => res(1000); // winner: offset 1000 → page 2 of 500-per-page
    });

    stub.library._jumpToPrefix
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise);

    stub.library.getTrackAtIndex = vi.fn().mockReturnValue(null);

    const p1 = stub._jumpViaBackend('d');
    const p2 = stub._jumpViaBackend('du');

    // Resolve winner first
    resolveSecond();
    await p2;

    // Only the winning page (2) must be fetched
    expect(stub.library._fetchPage).toHaveBeenCalledTimes(1);
    expect(stub.library._fetchPage).toHaveBeenCalledWith(2);

    // Stale call resolves — must not trigger a second _fetchPage
    resolveFirst();
    await p1;

    expect(stub.library._fetchPage).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: _jumpViaBackend defers scroll until page is loaded
// ---------------------------------------------------------------------------

describe('type-to-jump: _jumpViaBackend scroll timing', () => {
  it('scrollToOffset fires as soon as offset resolves, before _fetchPage completes', async () => {
    const stub = createStub();
    stub.library.filteredTracks = [];
    stub.library._isPaginated = () => true;
    stub.library._allPagesLoaded = false;

    stub.library._jumpToPrefix = vi.fn().mockResolvedValue(600);

    let resolveFetch;
    const fetchPromise = new Promise((res) => {
      resolveFetch = res;
    });
    stub.library._fetchPage = vi.fn().mockReturnValue(fetchPromise);
    stub.library.getTrackAtIndex = vi.fn().mockReturnValue(null);

    const p = stub._jumpViaBackend('m');

    // Flush _jumpToPrefix microtask — offset is known, scroll should have fired
    await Promise.resolve();
    await Promise.resolve();
    expect(stub.scrollToOffset).toHaveBeenCalledWith(600, expect.any(Number));

    // _isJumping stays true until _fetchPage resolves
    expect(stub._isJumping).toBe(true);

    resolveFetch();
    await p;
    expect(stub.scrollToOffset).toHaveBeenCalledTimes(1);
    expect(stub._isJumping).toBe(false);
  });

  it('_fetchPage is called with the correct page index', async () => {
    const stub = createStub();
    stub.library.filteredTracks = [];
    stub.library._isPaginated = () => true;
    stub.library._allPagesLoaded = false;
    stub.library._jumpToPrefix = vi.fn().mockResolvedValue(1250); // page 2 of 500-per-page
    stub.library.getTrackAtIndex = vi.fn().mockReturnValue(null);

    await stub._jumpViaBackend('x');

    expect(stub.library._fetchPage).toHaveBeenCalledWith(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: _isJumping loading-indicator state
// ---------------------------------------------------------------------------

describe('type-to-jump: _isJumping flag', () => {
  it('is true while in flight and false after completion', async () => {
    const stub = createStub();
    stub.library.filteredTracks = [];
    stub.library._isPaginated = () => true;
    stub.library._allPagesLoaded = false;
    stub.library._jumpToPrefix = vi.fn().mockResolvedValue(100);
    stub.library.getTrackAtIndex = vi.fn().mockReturnValue(null);

    let resolveFetch;
    stub.library._fetchPage = vi.fn().mockReturnValue(
      new Promise((res) => {
        resolveFetch = res;
      }),
    );

    expect(stub._isJumping).toBe(false);
    expect(stub._jumpingPrefix).toBe('');

    const p = stub._jumpViaBackend('m');

    // Set synchronously before first await yields
    expect(stub._isJumping).toBe(true);
    expect(stub._jumpingPrefix).toBe('m');

    resolveFetch();
    await p;

    expect(stub._isJumping).toBe(false);
    expect(stub._jumpingPrefix).toBe('');
  });

  it('is false when superseded, not when stale call exits', async () => {
    const stub = createStub();
    stub.library.filteredTracks = [];
    stub.library._isPaginated = () => true;
    stub.library._allPagesLoaded = false;
    stub.library.getTrackAtIndex = vi.fn().mockReturnValue(null);

    let resolveFirst, resolveSecond;
    stub.library._jumpToPrefix
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveFirst = () => res(0);
        }),
      )
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveSecond = () => res(100);
        }),
      );

    const p1 = stub._jumpViaBackend('d');
    const p2 = stub._jumpViaBackend('du');

    // Resolve the winning (second) call first
    resolveSecond();
    await p2;
    expect(stub._isJumping).toBe(false);

    // Stale first call resolves — superseded, does not re-set _isJumping
    resolveFirst();
    await p1;
    expect(stub._isJumping).toBe(false);
  });

  it('is false when offset resolves to null', async () => {
    const stub = createStub();
    stub.library.filteredTracks = [];
    stub.library._isPaginated = () => true;
    stub.library._allPagesLoaded = false;
    stub.library._jumpToPrefix = vi.fn().mockResolvedValue(null);

    await stub._jumpViaBackend('zzz');

    expect(stub._isJumping).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: regression — existing correct behavior preserved
// ---------------------------------------------------------------------------

describe('type-to-jump: correct single-key jumps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('typing "m" alone jumps to M. Ward', () => {
    const stub = createStub();
    stub.handleTypeToJump(makeKey('m'));
    expect(stub.selectedTracks.has('mw-1')).toBe(true);
  });

  it('typing "d" alone jumps to first d-artist (Dry Cleaning)', () => {
    const stub = createStub();
    stub.handleTypeToJump(makeKey('d'));
    expect(stub.selectedTracks.has('dc-1')).toBe(true);
  });

  it('typing "du" jumps to Dum Dum Girls', () => {
    const stub = createStub();
    stub.handleTypeToJump(makeKey('d'));
    stub.handleTypeToJump(makeKey('u'));
    expect(stub.selectedTracks.has('ddg-1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: jump_reliability_guard — rapid key supersession (TASK-350.1)
//
// While the guard is on, keystrokes coalesce into one pending jump and only
// the final generation of a burst is allowed to finalize: scroll position,
// selection, and the _isJumping flag.
// ---------------------------------------------------------------------------

describe('type-to-jump: rapid key supersession (jump_reliability_guard)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a burst of keystrokes issues a single backend lookup for the full prefix', async () => {
    const stub = createSlowBackendStub();

    stub.handleTypeToJump(makeKey('j'));
    stub.handleTypeToJump(makeKey('a'));
    stub.handleTypeToJump(makeKey('m'));

    // Nothing dispatched synchronously — the burst is still coalescing.
    expect(stub.library._jumpToPrefix).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);

    expect(stub.library._jumpToPrefix).toHaveBeenCalledTimes(1);
    expect(stub.library._jumpToPrefix.mock.calls[0][0]).toBe('jam');
  });

  it('only the latest generation finalizes when a slow stale lookup lands last', async () => {
    const stub = createSlowBackendStub();

    // Burst "j" fires the first lookup; it stays pending while "a" is typed.
    stub.handleTypeToJump(makeKey('j'));
    await vi.advanceTimersByTimeAsync(200);
    expect(stub.library._jumpToPrefix).toHaveBeenCalledTimes(1);

    // A burst typed while the jump is in flight is dropped (one jump at a time),
    // so the generation stays with the first lookup until it settles.
    stub.handleTypeToJump(makeKey('a'));
    await vi.advanceTimersByTimeAsync(200);
    expect(stub.library._jumpToPrefix).toHaveBeenCalledTimes(1);

    const [firstJump] = stub.pendingJumps;

    // Supersede the in-flight generation, then let the stale lookup land:
    // its scroll must not be applied.
    stub._nextJumpGen();
    firstJump.resolve(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(stub.scrollToOffset).not.toHaveBeenCalled();

    // The authoritative generation finalizes exactly once.
    const pending = stub._jumpViaBackend('ja');
    await vi.advanceTimersByTimeAsync(0);
    const latestJump = stub.pendingJumps[1];
    latestJump.resolve(2000);
    await pending;
    expect(stub.scrollToOffset).toHaveBeenCalledTimes(1);
    expect(stub.scrollToOffset).toHaveBeenCalledWith(2000, expect.any(Number));

    expect(stub.scrollToTrack).not.toHaveBeenCalled();
    expect(stub.selectedTracks.size).toBe(0);
  });

  it('a newer generation supersedes the in-flight backend jump', async () => {
    const stub = createSlowBackendStub();
    stub.library.filteredTracks = TRACKS;

    stub.handleTypeToJump(makeKey('j'));
    await vi.advanceTimersByTimeAsync(200);
    expect(stub.library._jumpToPrefix).toHaveBeenCalledTimes(1);

    const [staleJump] = stub.pendingJumps;

    // A newer burst bumps the generation token before any local match runs,
    // so the in-flight lookup is already superseded.
    stub._executeTypeToJump('ja');
    expect(stub.scrollToTrack).not.toHaveBeenCalled();

    staleJump.resolve(10);
    await vi.advanceTimersByTimeAsync(200);

    // The superseded offset must not move the viewport or select anything.
    expect(stub.scrollToOffset).not.toHaveBeenCalled();
    expect(stub.scrollToTrack).not.toHaveBeenCalled();
    expect(stub.selectedTracks.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: jump_reliability_guard off — legacy synchronous path
// ---------------------------------------------------------------------------

describe('type-to-jump: jump_reliability_guard disabled', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('jumps synchronously per keystroke instead of coalescing', () => {
    const stub = createStub();
    stub.jumpReliabilityGuard = () => false;

    stub.handleTypeToJump(makeKey('d'));
    expect(stub.scrollToTrack).toHaveBeenCalledWith('dc-1');
    expect(stub.selectedTracks.has('dc-1')).toBe(true);

    stub.handleTypeToJump(makeKey('u'));
    expect(stub.scrollToTrack).toHaveBeenLastCalledWith('ddg-1');
  });

  it('_jumpViaBackend fires immediately without coalescing or a timeout timer', async () => {
    const stub = createStub();
    stub.jumpReliabilityGuard = () => false;
    stub.library.filteredTracks = [];
    stub.library._isPaginated = () => true;
    stub.library._allPagesLoaded = false;
    stub.library._jumpToPrefix = vi.fn().mockResolvedValue(100);
    stub.library._fetchPage = vi.fn().mockResolvedValue(undefined);
    stub.library.getTrackAtIndex = vi.fn().mockReturnValue(null);

    await stub._jumpViaBackend('d');

    expect(stub.library._jumpToPrefix).toHaveBeenCalledWith('d');
    expect(stub.scrollToOffset).toHaveBeenCalledWith(100, expect.any(Number));
    expect(stub._jumpTimeoutTimer).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Tests: non-blocking timeout fallback
// ---------------------------------------------------------------------------

describe('type-to-jump: backend timeout fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores the previous scroll position and clears the jump state on timeout', async () => {
    const stub = createSlowBackendStub();
    stub.$store.ui = {
      view: 'library',
      featureFlags: { jump_reliability_guard: true },
    };
    stub.$store.ui.jumpBackendTimeoutMs = 500;
    stub._rowHeight = 34;
    // Page fetch never delivers rows: the jump stays pending until timeout.
    stub.library._fetchPage = vi.fn().mockReturnValue(new Promise(() => {}));
    stub.scrollToOffset = vi.fn((offset, gen) => {
      stub._scrollToRowIndex(offset, false, gen);
    });
    stub._scrollToRowIndex = vi.fn((idx, _smooth, gen) => {
      if (gen != null && gen !== stub._jumpGen) return;
      stub._scrollTop = idx * stub._rowHeight;
    });

    stub.handleTypeToJump(makeKey('j'));
    await vi.advanceTimersByTimeAsync(200);

    const [jump] = stub.pendingJumps;
    // The lookup resolves, but the page fetch never delivers rows, so the
    // jump stays pending until the timeout fallback fires.
    jump.resolve(300);
    await vi.advanceTimersByTimeAsync(50);

    // Viewport already snapped to the target while the page fetch is pending.
    expect(stub.scrollToOffset).toHaveBeenCalledWith(300, expect.any(Number));

    // The timeout re-arms when the offset lands, so the fallback fires 500ms
    // after the lookup resolved while the page fetch is still pending.
    await vi.advanceTimersByTimeAsync(500);

    expect(stub._isJumping).toBe(false);
    expect(stub._jumpingPrefix).toBe('');
    // Rollback: back to the pre-jump row, with an explicit null generation so
    // the restore write is authoritative even though the jump's gen was
    // discarded.
    expect(stub._scrollToRowIndex).toHaveBeenLastCalledWith(0, false, null);
    expect(stub._scrollTop).toBe(0);

    // A late resolution of the cancelled lookup must not resurrect it.
    stub.library.getTrackAtIndex = vi.fn().mockReturnValue({ id: 'late' });
    jump.resolve(300);
    await vi.advanceTimersByTimeAsync(100);
    expect(stub._isJumping).toBe(false);
    expect(stub.selectedTracks.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: scroll-state isolation for stale responses (flag off)
//
// _scrollToRowIndex refuses a write requested by a jump generation that has
// already been superseded, so a stale _jumpViaBackend cannot move the viewport.
// ---------------------------------------------------------------------------

describe('type-to-jump: stale responses do not mutate scroll state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a superseded _jumpViaBackend leaves container scrollTop untouched', async () => {
    const stub = createSlowBackendStub({ guard: false });

    const container = {
      scrollTop: 0,
      clientHeight: 340,
      scrollTo: vi.fn((opts) => {
        container.scrollTop = opts.top;
      }),
      querySelector: () => null,
    };
    stub.$refs = { scrollContainer: container };
    Object.assign(stub, virtualScrollMixin());

    let resolveFirst;
    let resolveSecond;
    stub.library._jumpToPrefix
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveFirst = () => res(0);
        }),
      )
      .mockReturnValueOnce(
        new Promise((res) => {
          resolveSecond = () => res(1000);
        }),
      );

    const p1 = stub._jumpViaBackend('d');
    const p2 = stub._jumpViaBackend('du');

    // Newest generation wins first.
    resolveSecond();
    await p2;
    const scrollAfterNewer = container.scrollTop;
    expect(scrollAfterNewer).toBeGreaterThan(0);

    // Stale generation resolves afterwards — its scroll write is discarded.
    resolveFirst();
    await p1;
    expect(container.scrollTop).toBe(scrollAfterNewer);
  });
});
