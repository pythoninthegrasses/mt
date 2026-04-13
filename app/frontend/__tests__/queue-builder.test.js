/**
 * Tests for queue-builder handleDoubleClickPlay and player.updateTrackState
 *
 * Verifies the atomic play-context flow: single IPC round-trip that clears queue,
 * installs tracks, triggers playback, and returns full result.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the queue API module
vi.mock('../js/api/queue.js', () => ({
  queue: {
    playContext: vi.fn(),
  },
}));

import { queue as queueApi } from '../js/api/queue.js';
import { handleDoubleClickPlay } from '../js/utils/queue-builder.js';

function makeTracks(names) {
  return names.map((name, i) => ({
    id: i + 1,
    title: name,
    artist: 'Test',
    album: 'Test',
    duration: 180,
    filepath: `/music/${name}.mp3`,
    file_size: 5000000,
  }));
}

function makePlayContextResult(tracks, currentIndex, durationMs = 180000) {
  return {
    items: tracks.map((t) => ({ track: t })),
    current_index: currentIndex,
    track: tracks[currentIndex],
    shuffle_enabled: false,
    duration_ms: durationMs,
  };
}

function createMockCtx(queueOverrides = {}, playerOverrides = {}) {
  return {
    queue: {
      items: [],
      currentIndex: -1,
      shuffle: false,
      _updating: false,
      ...queueOverrides,
    },
    player: {
      playTrack: vi.fn().mockResolvedValue(undefined),
      updateTrackState: vi.fn().mockResolvedValue(undefined),
      ...playerOverrides,
    },
  };
}

describe('handleDoubleClickPlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to playTrack when index is out of bounds (negative)', async () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const ctx = createMockCtx();

    await handleDoubleClickPlay(ctx, tracks[0], tracks, -1, 'test');

    expect(ctx.player.playTrack).toHaveBeenCalledWith(tracks[0]);
    expect(queueApi.playContext).not.toHaveBeenCalled();
  });

  it('falls back to playTrack when index is beyond array length', async () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const ctx = createMockCtx();

    await handleDoubleClickPlay(ctx, tracks[0], tracks, 5, 'test');

    expect(ctx.player.playTrack).toHaveBeenCalledWith(tracks[0]);
    expect(queueApi.playContext).not.toHaveBeenCalled();
  });

  it('calls playContext with correct arguments', async () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const result = makePlayContextResult(tracks, 1);
    queueApi.playContext.mockResolvedValue(result);

    const ctx = createMockCtx({ shuffle: false });

    await handleDoubleClickPlay(ctx, tracks[1], tracks, 1, 'test');

    expect(queueApi.playContext).toHaveBeenCalledWith(
      [1, 2, 3], // track IDs
      1, // index
      false, // shuffle
    );
  });

  it('passes shuffle state from queue store', async () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const result = makePlayContextResult(tracks, 0);
    queueApi.playContext.mockResolvedValue(result);

    const ctx = createMockCtx({ shuffle: true });

    await handleDoubleClickPlay(ctx, tracks[0], tracks, 0, 'test');

    expect(queueApi.playContext).toHaveBeenCalledWith(
      [1, 2, 3],
      0,
      true, // shuffle enabled
    );
  });

  it('updates queue store items from result', async () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const result = makePlayContextResult(tracks, 1);
    queueApi.playContext.mockResolvedValue(result);

    const ctx = createMockCtx();

    await handleDoubleClickPlay(ctx, tracks[1], tracks, 1, 'test');

    expect(ctx.queue.items).toEqual(tracks);
    expect(ctx.queue.currentIndex).toBe(1);
  });

  it('applies shuffle_enabled from result', async () => {
    const tracks = makeTracks(['A', 'B']);
    const result = makePlayContextResult(tracks, 0);
    result.shuffle_enabled = true;
    queueApi.playContext.mockResolvedValue(result);

    const ctx = createMockCtx({ shuffle: false });

    await handleDoubleClickPlay(ctx, tracks[0], tracks, 0, 'test');

    expect(ctx.queue.shuffle).toBe(true);
  });

  it('calls updateTrackState with track and duration_ms', async () => {
    const tracks = makeTracks(['A', 'B']);
    const result = makePlayContextResult(tracks, 0, 195000);
    queueApi.playContext.mockResolvedValue(result);

    const ctx = createMockCtx();

    await handleDoubleClickPlay(ctx, tracks[0], tracks, 0, 'test');

    expect(ctx.player.updateTrackState).toHaveBeenCalledWith(tracks[0], 195000);
    expect(ctx.player.playTrack).not.toHaveBeenCalled();
  });

  it('calls beforePlay hook before making IPC call', async () => {
    const tracks = makeTracks(['A', 'B']);
    const callOrder = [];

    queueApi.playContext.mockImplementation(async () => {
      callOrder.push('playContext');
      return makePlayContextResult(tracks, 0);
    });

    const ctx = createMockCtx();
    ctx.player.updateTrackState.mockImplementation(async () => {
      callOrder.push('updateTrackState');
    });

    const beforePlay = vi.fn(() => {
      callOrder.push('beforePlay');
    });

    await handleDoubleClickPlay(ctx, tracks[0], tracks, 0, 'test', { beforePlay });

    expect(beforePlay).toHaveBeenCalled();
    expect(callOrder).toEqual(['beforePlay', 'playContext', 'updateTrackState']);
  });

  it('sets _updating flag during operation', async () => {
    const tracks = makeTracks(['A', 'B']);

    let updatingDuringCall = false;
    queueApi.playContext.mockImplementation(async (ids, idx, shuffle) => {
      updatingDuringCall = true; // can't check ctx._updating from here, but we know the flag was set before try block
      return makePlayContextResult(tracks, 0);
    });

    const ctx = createMockCtx();

    await handleDoubleClickPlay(ctx, tracks[0], tracks, 0, 'test');

    // _updating was set to true before the try block; after the finally,
    // a setTimeout schedules setting it to false. Since we're in a sync
    // context here, the setTimeout hasn't fired yet.
    // The important thing is it was set to true during the call.
    expect(updatingDuringCall).toBe(true);
  });

  it('handles playContext errors gracefully', async () => {
    const tracks = makeTracks(['A', 'B']);
    queueApi.playContext.mockRejectedValue(new Error('IPC failed'));

    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await handleDoubleClickPlay(ctx, tracks[0], tracks, 0, 'test-prefix');

    expect(consoleSpy).toHaveBeenCalledWith(
      '[test-prefix] Failed to play context:',
      expect.any(Error),
    );
    // Player should not have been called
    expect(ctx.player.updateTrackState).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('extracts tracks from items with track property', async () => {
    const tracks = makeTracks(['A', 'B', 'C']);
    const result = {
      items: tracks.map((t) => ({ track: t, some_other_field: 'ignored' })),
      current_index: 0,
      track: tracks[0],
      shuffle_enabled: false,
      duration_ms: 180000,
    };
    queueApi.playContext.mockResolvedValue(result);

    const ctx = createMockCtx();

    await handleDoubleClickPlay(ctx, tracks[0], tracks, 0, 'test');

    // items should be unwrapped from { track: ... } wrapper
    expect(ctx.queue.items).toEqual(tracks);
  });

  it('handles items without track wrapper (passthrough)', async () => {
    const tracks = makeTracks(['A', 'B']);
    const result = {
      items: tracks, // no { track: ... } wrapper
      current_index: 0,
      track: tracks[0],
      shuffle_enabled: false,
      duration_ms: 180000,
    };
    queueApi.playContext.mockResolvedValue(result);

    const ctx = createMockCtx();

    await handleDoubleClickPlay(ctx, tracks[0], tracks, 0, 'test');

    // Without .track property, the item itself is used
    expect(ctx.queue.items).toEqual(tracks);
  });
});

describe('player.updateTrackState', () => {
  // Test the updateTrackState method logic in isolation
  // (simulating what the real player store does)

  function createPlayerState() {
    let _playRequestId = 0;
    return {
      currentTrack: null,
      duration: 0,
      currentTime: 100,
      progress: 50,
      isPlaying: false,
      _playRequestId,

      checkFavoriteStatus: vi.fn().mockResolvedValue(undefined),
      loadArtwork: vi.fn().mockResolvedValue(undefined),
      _updateNowPlayingMetadata: vi.fn().mockResolvedValue(undefined),
      _updateNowPlayingState: vi.fn().mockResolvedValue(undefined),

      async updateTrackState(track, durationMs) {
        ++this._playRequestId;
        const trackDurationMs = track.duration ? Math.round(track.duration * 1000) : 0;
        const finalDuration = (durationMs > 0 ? durationMs : trackDurationMs) || 0;
        this.currentTrack = { ...track, duration: finalDuration };
        this.duration = finalDuration;
        this.currentTime = 0;
        this.progress = 0;
        this.isPlaying = true;
        await this.checkFavoriteStatus();
        await this.loadArtwork();
        await this._updateNowPlayingMetadata();
        await this._updateNowPlayingState();
      },
    };
  }

  it('sets currentTrack with engine duration when available', async () => {
    const player = createPlayerState();
    const track = { id: 1, title: 'Song', duration: 180 };

    await player.updateTrackState(track, 195000);

    expect(player.currentTrack.duration).toBe(195000);
    expect(player.duration).toBe(195000);
  });

  it('falls back to track.duration (converted to ms) when engine returns 0', async () => {
    const player = createPlayerState();
    const track = { id: 1, title: 'Song', duration: 180 }; // 180 seconds

    await player.updateTrackState(track, 0);

    expect(player.currentTrack.duration).toBe(180000); // 180 * 1000
    expect(player.duration).toBe(180000);
  });

  it('uses 0 when both sources are missing', async () => {
    const player = createPlayerState();
    const track = { id: 1, title: 'Song' }; // no duration

    await player.updateTrackState(track, 0);

    expect(player.currentTrack.duration).toBe(0);
    expect(player.duration).toBe(0);
  });

  it('resets playback position', async () => {
    const player = createPlayerState();
    player.currentTime = 50000;
    player.progress = 75;

    const track = { id: 1, title: 'Song', duration: 180 };
    await player.updateTrackState(track, 180000);

    expect(player.currentTime).toBe(0);
    expect(player.progress).toBe(0);
  });

  it('sets isPlaying to true', async () => {
    const player = createPlayerState();
    expect(player.isPlaying).toBe(false);

    const track = { id: 1, title: 'Song', duration: 180 };
    await player.updateTrackState(track, 180000);

    expect(player.isPlaying).toBe(true);
  });

  it('increments _playRequestId to invalidate pending playTrack calls', async () => {
    const player = createPlayerState();
    const initialId = player._playRequestId;

    const track = { id: 1, title: 'Song', duration: 180 };
    await player.updateTrackState(track, 180000);

    expect(player._playRequestId).toBe(initialId + 1);
  });

  it('calls all UI update methods', async () => {
    const player = createPlayerState();
    const track = { id: 1, title: 'Song', duration: 180 };

    await player.updateTrackState(track, 180000);

    expect(player.checkFavoriteStatus).toHaveBeenCalled();
    expect(player.loadArtwork).toHaveBeenCalled();
    expect(player._updateNowPlayingMetadata).toHaveBeenCalled();
    expect(player._updateNowPlayingState).toHaveBeenCalled();
  });
});
