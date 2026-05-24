/**
 * Unit tests for the type-to-jump mixin.
 *
 * Covers:
 *   1. Buffer debounce timeout (should be 1500ms, not 500ms)
 *   2. _jumpViaBackend cancellation via generation counter
 *   3. Slow-typed multi-character prefix resolves to the correct artist
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { typeToJumpMixin } from '../js/mixins/type-to-jump.js';

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
  return { key: char, metaKey: false, ctrlKey: false, altKey: false, target: { tagName: 'DIV' } };
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
    expect(stub.scrollToOffset).toHaveBeenCalledWith(100);

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
    expect(stub.scrollToOffset).toHaveBeenCalledWith(600);

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
