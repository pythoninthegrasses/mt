/**
 * Tests for the libraryStats computation.
 *
 * Verifies that stats are computed from backend totals
 * (totalTracks, totalDuration, totalFileSize) rather than
 * iterating over loaded tracks.
 */

import { describe, expect, it } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { computeLibraryStats } from '../js/utils/library-stats.js';

// ---------------------------------------------------------------------------
// computeLibraryStats
// ---------------------------------------------------------------------------

describe('computeLibraryStats', () => {
  it('formats count, size, and duration from backend totals', () => {
    // 1000 tracks, ~6.9 GB, 2d 22h 18m (= 253080 seconds)
    const result = computeLibraryStats(1000, 253080, 7_410_065_408);
    expect(result).toBe('1000 files  6.9 GB  2d 22h 18m');
  });

  it('handles zero values', () => {
    const result = computeLibraryStats(0, 0, 0);
    expect(result).toBe('0 files  0 B  0m');
  });

  it('formats small libraries correctly', () => {
    // 5 tracks, 25 MB, 15 minutes
    const result = computeLibraryStats(5, 900, 26_214_400);
    expect(result).toBe('5 files  25.0 MB  15m');
  });

  it('formats hours without days', () => {
    // 100 tracks, 1 GB, 2h 30m (= 9000 seconds)
    const result = computeLibraryStats(100, 9000, 1_073_741_824);
    expect(result).toBe('100 files  1.0 GB  2h 30m');
  });

  it('does not depend on loaded tracks array', () => {
    // The function takes pre-computed totals, not a tracks array
    // This test verifies the function signature accepts scalar values
    const result = computeLibraryStats(50000, 5_000_000, 500_000_000_000);
    expect(result).toContain('50000 files');
    expect(result).toContain('465.7 GB');
  });

  test.prop([
    fc.nat({ max: 1_000_000 }),
    fc.nat({ max: 100_000_000 }),
    fc.nat({ max: 10_000_000_000_000 }),
  ])(
    'always returns string with expected format (count files  size  duration)',
    (count, duration, size) => {
      const result = computeLibraryStats(count, duration, size);
      // Format: "<count> files  <size>  <duration>"
      expect(result).toMatch(/^\d+ files  .+  .+$/);
    },
  );

  test.prop([
    fc.nat({ max: 1_000_000 }),
    fc.nat({ max: 100_000_000 }),
    fc.nat({ max: 10_000_000_000_000 }),
  ])(
    'count in output matches input count',
    (count, duration, size) => {
      const result = computeLibraryStats(count, duration, size);
      const outputCount = parseInt(result.split(' files')[0], 10);
      expect(outputCount).toBe(count);
    },
  );
});
