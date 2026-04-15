/**
 * Compute formatted library stats string from backend totals.
 *
 * Uses pre-computed totals (totalTracks, totalDuration, totalFileSize)
 * from the backend rather than iterating over loaded tracks, so stats
 * are correct regardless of how many pages have been fetched.
 */

import { formatBytes } from './formatting.js';

/**
 * Format duration in seconds to a human-readable string.
 * @param {number} seconds - Total seconds
 * @returns {string} e.g. "2d 21h 38m", "3h 15m", "42m", "0m"
 */
function formatDurationLong(seconds) {
  if (!seconds || isNaN(seconds)) return '0m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * Compute the library stats display string from backend totals.
 * @param {number} totalTracks - Total track count from backend
 * @param {number} totalDuration - Total duration in seconds from backend
 * @param {number} totalFileSize - Total file size in bytes from backend
 * @returns {string} e.g. "1000 files  6.9 GB  2d 21h 38m"
 */
export function computeLibraryStats(totalTracks, totalDuration, totalFileSize) {
  const count = totalTracks || 0;
  const sizeStr = formatBytes(totalFileSize);
  const durationStr = formatDurationLong(totalDuration);
  return `${count} files  ${sizeStr}  ${durationStr}`;
}
