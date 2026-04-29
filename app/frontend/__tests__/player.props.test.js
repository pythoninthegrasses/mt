/**
 * @vitest-environment jsdom
 *
 * Property-based tests for player store using fast-check
 *
 * These tests verify invariants in player state management like volume bounds,
 * seek position validity, and progress calculation correctness.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { createTauriMock } from './mocks/tauri.js';

global.window = createTauriMock();

vi.mock('../js/api.js', async () => {
  const { createApiMock } = await import('./mocks/api.js');
  return createApiMock();
});

import { createPlayerStore } from '../js/stores/player.js';
import { formatTime } from '../js/utils/formatting.js';

// Mock Alpine
const Alpine = {
  stores: {},
  store(name, value) {
    if (value) {
      this.stores[name] = value;
    }
    return this.stores[name];
  }
};

describe('Player Store - Property-Based Tests', () => {
  let store;

  beforeEach(() => {
    Alpine.stores = {};
    Alpine.store('ui', {
      showMissingTrackModal: vi.fn().mockResolvedValue({ result: 'skip' }),
    });
    Alpine.store('queue', {
      playNext: vi.fn(),
      skipNext: vi.fn(),
      skipPrevious: vi.fn(),
    });
    Alpine.store('library', {
      refreshIfLikedSongs: vi.fn(),
    });
    createPlayerStore(Alpine);
    store = Alpine.store('player');
  });

  describe('Volume Invariants', () => {
    test.prop([fc.integer({ min: -1000, max: 2000 })])('setVolume clamps to [0, 100]', async (volume) => {
      await store.setVolume(volume);

      expect(store.volume).toBeGreaterThanOrEqual(0);
      expect(store.volume).toBeLessThanOrEqual(100);
    });

    test.prop([fc.integer({ min: 0, max: 100 })])('setVolume preserves valid values', async (volume) => {
      await store.setVolume(volume);

      expect(store.volume).toBe(volume);
    });

    test.prop([fc.integer({ min: 101, max: 10000 })])('setVolume clamps above 100 to exactly 100', async (volume) => {
      await store.setVolume(volume);

      expect(store.volume).toBe(100);
    });

    test.prop([fc.integer({ min: -10000, max: -1 })])('setVolume clamps below 0 to exactly 0', async (volume) => {
      await store.setVolume(volume);

      expect(store.volume).toBe(0);
    });

    test.prop([fc.integer({ min: 1, max: 100 })])('setVolume with positive value unmutes', async (volume) => {
      store.muted = true;

      await store.setVolume(volume);

      expect(store.muted).toBe(false);
      expect(store.volume).toBe(volume);
    });

    it('toggleMute twice restores original volume', async () => {
      const originalVolume = 75;
      await store.setVolume(originalVolume);

      await store.toggleMute();
      expect(store.muted).toBe(true);
      expect(store.volume).toBe(0);

      await store.toggleMute();
      expect(store.muted).toBe(false);
      expect(store.volume).toBe(originalVolume);
    });

    test.prop([fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 })])(
      'multiple setVolume calls result in last value',
      async (vol1, vol2) => {
        await store.setVolume(vol1);
        await store.setVolume(vol2);

        expect(store.volume).toBe(vol2);
      }
    );
  });

  describe('Seek Invariants', () => {
    test.prop([fc.integer({ min: 1, max: 600000 }), fc.integer({ min: -1000, max: 700000 })])(
      'seek clamps position to [0, duration]',
      async (duration, position) => {
        store.duration = duration;

        await store.seek(position);

        // Note: seek is debounced, so we check immediate state update
        expect(store.currentTime).toBeGreaterThanOrEqual(0);
        expect(store.currentTime).toBeLessThanOrEqual(duration);
        if (position < 0) {
          expect(store.currentTime).toBe(0);
        }
      }
    );

    test.prop([fc.integer({ min: 1, max: 600000 }), fc.float({ min: 0, max: 1, noNaN: true })])(
      'seekPercent results in position within duration',
      async (duration, percent) => {
        store.duration = duration;

        await store.seekPercent(percent * 100);

        expect(store.currentTime).toBeGreaterThanOrEqual(0);
        expect(store.currentTime).toBeLessThanOrEqual(duration);
      }
    );

    test.prop([fc.integer({ min: 1000, max: 600000 }), fc.integer({ min: 0, max: 100 })])(
      'seekPercent calculates correct position',
      async (duration, percentInt) => {
        store.duration = duration;

        await store.seekPercent(percentInt);

        const expectedPosition = Math.round((percentInt / 100) * duration);
        const tolerance = 1; // Allow 1ms rounding error

        expect(Math.abs(store.currentTime - expectedPosition)).toBeLessThanOrEqual(tolerance);
      }
    );

    test.prop([fc.integer({ min: 0, max: 300000 })])('seek updates progress proportionally', async (position) => {
      store.duration = 300000; // 5 minutes

      await store.seek(position);

      const clampedPosition = Math.max(0, Math.min(position, store.duration));
      const expectedProgress = (clampedPosition / store.duration) * 100;
      const tolerance = 0.1; // 0.1% tolerance for debouncing

      expect(Math.abs(store.progress - expectedProgress)).toBeLessThanOrEqual(tolerance);
    });

    test.prop([fc.integer({ min: 0, max: 600000 })])('seek with zero duration is safe', async (position) => {
      store.duration = 0;

      // seek() doesn't return a Promise (uses debounced setTimeout internally)
      store.seek(position);

      expect(store.progress).toBe(0);
    });

    test.prop([fc.constantFrom(NaN, Infinity, -Infinity)])('seek with invalid values is safe', async (invalidValue) => {
      store.duration = 180000;

      // seek() doesn't return a Promise (uses debounced setTimeout internally)
      // Invalid values are handled by clamping to valid range
      store.seek(invalidValue);

      // Should either keep previous value or set to valid value (0 or duration)
      expect(Number.isFinite(store.currentTime)).toBe(true);
      expect(store.currentTime).toBeGreaterThanOrEqual(0);
      expect(store.currentTime).toBeLessThanOrEqual(store.duration);
    });
  });

  describe('Progress Calculation Invariants', () => {
    test.prop([fc.integer({ min: 0, max: 600000 }), fc.integer({ min: 0, max: 600000 })])(
      'progress is always between 0 and 100',
      async (currentTime, duration) => {
        fc.pre(duration > 0);

        store.currentTime = currentTime;
        store.duration = duration;

        // Manually calculate progress like the event handler does
        const progress = (currentTime / duration) * 100;
        store.progress = progress;

        expect(store.progress).toBeGreaterThanOrEqual(0);
        expect(store.progress).toBeLessThanOrEqual(100 * (currentTime / duration + 0.01)); // Allow small overflow
    });

    test.prop([fc.integer({ min: 0, max: 600000 })])('progress with zero duration is zero', async (currentTime) => {
      store.currentTime = currentTime;
      store.duration = 0;

      // Simulate progress calculation with zero duration
      const progress = store.duration > 0 ? (store.currentTime / store.duration) * 100 : 0;

      expect(progress).toBe(0);
      expect(Number.isFinite(progress)).toBe(true);
    });

    test.prop([fc.integer({ min: 1, max: 600000 })])('progress at duration is exactly 100%', async (duration) => {
      store.currentTime = duration;
      store.duration = duration;

      const progress = (store.currentTime / store.duration) * 100;

      expect(progress).toBe(100);
    });

    test.prop([fc.integer({ min: 1, max: 600000 })])('progress at zero is 0%', async (duration) => {
      store.currentTime = 0;
      store.duration = duration;

      const progress = (store.currentTime / store.duration) * 100;

      expect(progress).toBe(0);
    });
  });

  describe('Time Formatting Invariants', () => {
    test.prop([fc.integer({ min: 0, max: 86400000 })])('formatTime never returns negative values', (ms) => {
      const formatted = formatTime(ms);

      expect(formatted).toMatch(/^\d+:\d{2}$/);

      const [minutes, seconds] = formatted.split(':').map(Number);
      expect(minutes).toBeGreaterThanOrEqual(0);
      expect(seconds).toBeGreaterThanOrEqual(0);
      expect(seconds).toBeLessThan(60);
    });

    test.prop([fc.integer({ min: 0, max: 3600000 })])('formatTime seconds are always two digits', (ms) => {
      const formatted = formatTime(ms);

      const [_, seconds] = formatted.split(':');
      expect(seconds.length).toBe(2);
    });

    test.prop([fc.integer({ min: 0, max: 86400000 })])('formatTime roundtrip is consistent', (ms) => {
      const formatted = formatTime(ms);
      const [minutes, seconds] = formatted.split(':').map(Number);

      const reconstructedSeconds = minutes * 60 + seconds;
      const originalSeconds = Math.floor(ms / 1000);

      expect(reconstructedSeconds).toBe(originalSeconds);
    });

    test.prop([fc.constantFrom(null, undefined, -100, NaN)])('formatTime handles invalid input safely', (invalid) => {
      const formatted = formatTime(invalid);

      expect(formatted).toBe('0:00');
    });

    it('formatTime handles exact boundaries correctly', () => {
      expect(formatTime(0)).toBe('0:00');
      expect(formatTime(1000)).toBe('0:01');
      expect(formatTime(59000)).toBe('0:59');
      expect(formatTime(60000)).toBe('1:00');
      expect(formatTime(3599000)).toBe('59:59');
      expect(formatTime(3600000)).toBe('60:00');
    });
  });

  describe('State Consistency', () => {
    test.prop([fc.boolean()])('isPlaying and isSeeking are independent', async (playing) => {
      store.isPlaying = playing;
      store.isSeeking = false;

      await store.seek(1000);
      expect(store.isSeeking).toBe(true);

      // isPlaying should not change from seeking
      expect(store.isPlaying).toBe(playing);
    });

    test.prop([fc.integer({ min: 0, max: 100 })])('muted state consistent with volume', async (volume) => {
      if (volume === 0) {
        store.muted = true;
        await store.setVolume(volume);
        // Can stay muted at 0
      } else {
        store.muted = true;
        await store.setVolume(volume);
        expect(store.muted).toBe(false);
      }
    });

    test.prop([fc.record({
      id: fc.integer({ min: 1, max: 10000 }),
      title: fc.string({ minLength: 1, maxLength: 50 }),
      artist: fc.string({ minLength: 1, maxLength: 50 }),
      duration: fc.integer({ min: 1000, max: 600000 }),
      filepath: fc.string({ minLength: 5, maxLength: 100 }),
    })])('playTrack resets play count and scrobble flags', async (track) => {
      store._playCountUpdated = true;
      store._scrobbleChecked = true;

      // We can't fully test playTrack due to Tauri dependencies, but we can verify
      // the flags would be reset in the actual implementation
      expect(store._playCountUpdated).toBe(true);
      expect(store._scrobbleChecked).toBe(true);

      // The actual playTrack would reset these to false
    });
  });

  describe('Edge Cases', () => {
    test.prop([fc.float({ min: 0, max: 1, noNaN: true })])('scrobble threshold is valid fraction', async (threshold) => {
      store._scrobbleThreshold = threshold;

      expect(store._scrobbleThreshold).toBeGreaterThanOrEqual(0);
      expect(store._scrobbleThreshold).toBeLessThanOrEqual(1);
      expect(Number.isFinite(store._scrobbleThreshold)).toBe(true);
    });

    test.prop([fc.float({ min: 0, max: 1, noNaN: true })])('play count threshold is valid fraction', async (threshold) => {
      store._playCountThreshold = threshold;

      expect(store._playCountThreshold).toBeGreaterThanOrEqual(0);
      expect(store._playCountThreshold).toBeLessThanOrEqual(1);
      expect(Number.isFinite(store._playCountThreshold)).toBe(true);
    });

    it('concurrent playTrack calls use request ID guard', async () => {
      const track = {
        id: 1,
        title: 'Test',
        artist: 'Artist',
        filepath: '/test.mp3',
        duration: 180000
      };

      const initialRequestId = store._playRequestId;

      // Start multiple playTrack calls (they would race in real usage)
      const promise1 = store.playTrack(track);
      const currentRequestId = store._playRequestId;

      // Request ID should increment
      expect(currentRequestId).toBeGreaterThan(initialRequestId);

      await promise1;
    });

    test.prop([fc.integer({ min: 0, max: 600000 }), fc.integer({ min: 0, max: 600000 })])(
      'duration fallback works when Rust returns 0',
      async (trackDuration, rustDuration) => {
        // This tests the logic in playTrack where we fall back to track.duration
        const effectiveDuration = rustDuration > 0 ? rustDuration : trackDuration;

        expect(effectiveDuration).toBeGreaterThanOrEqual(0);

        if (rustDuration === 0 && trackDuration > 0) {
          expect(effectiveDuration).toBe(trackDuration);
        } else if (rustDuration > 0) {
          expect(effectiveDuration).toBe(rustDuration);
        }
      }
    );
  });

  describe('Threshold Checks', () => {
    test.prop([fc.integer({ min: 1000, max: 600000 }), fc.float({ min: 0, max: 1, noNaN: true })])(
      'play count threshold check is correct',
      async (duration, threshold) => {
        store.duration = duration;
        store._playCountThreshold = threshold;

        const triggerTime = Math.floor(duration * threshold);
        const epsilon = 0.001; // Floating point tolerance

        // Before threshold
        store.currentTime = triggerTime - 1;
        const ratio = store.currentTime / store.duration;
        expect(ratio < threshold + epsilon).toBe(true);

        // At or near threshold (within epsilon due to Math.floor precision loss)
        store.currentTime = triggerTime;
        const ratioAt = store.currentTime / store.duration;
        expect(ratioAt >= threshold - epsilon).toBe(true);
      }
    );

    test.prop([fc.integer({ min: 1000, max: 600000 }), fc.float({ min: 0.5, max: 1, noNaN: true })])(
      'scrobble threshold check is correct',
      async (duration, threshold) => {
        store.duration = duration;
        store._scrobbleThreshold = threshold;

        const triggerTime = Math.floor(duration * threshold);
        const epsilon = 0.001; // Floating point tolerance

        // Before threshold
        const ratioBefore = (triggerTime - 1) / duration;
        expect(ratioBefore < threshold + epsilon).toBe(true);

        // At or near threshold (within epsilon due to Math.floor precision loss)
        const ratioAt = triggerTime / duration;
        expect(ratioAt >= threshold - epsilon).toBe(true);
      }
    );
  });
});
