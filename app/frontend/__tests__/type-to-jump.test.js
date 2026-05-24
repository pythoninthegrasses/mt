/**
 * Unit tests for the type-to-jump mixin.
 *
 * Covers:
 *   1. Buffer debounce timeout (should be 1500ms, not 500ms)
 *   2. _jumpViaBackend cancellation via generation counter
 *   3. Slow-typed multi-character prefix resolves to the correct artist
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
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
    _jumpToPrefix: vi.fn(),
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

    const firstPromise = new Promise((res) => { resolveFirst = () => res(0); });
    const secondPromise = new Promise((res) => { resolveSecond = () => res(100); });

    stub.library._jumpToPrefix
      .mockReturnValueOnce(firstPromise)   // call #1 → offset 0
      .mockReturnValueOnce(secondPromise);  // call #2 → offset 100

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
});

// ---------------------------------------------------------------------------
// Tests: regression — existing correct behavior preserved
// ---------------------------------------------------------------------------

describe('type-to-jump: correct single-key jumps', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

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
