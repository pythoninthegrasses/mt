/**
 * Shared utility functions for formatting time, data sizes, and other display values.
 *
 * Consolidates formatting logic used across player, player-controls, and metadata components.
 */

/**
 * Format milliseconds as M:SS
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted time (e.g., "3:45", "0:00")
 */
export function formatTime(ms) {
  if (!ms || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format seconds as M:SS (for duration values in seconds)
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted time (e.g., "3:45", "0:00")
 */
export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format bytes as human-readable size
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "4.2 MB", "1.5 GB")
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = (bytes / Math.pow(k, i)).toFixed(1);
  return `${size} ${units[i]}`;
}

/**
 * Format seconds as M:SS, returning '--:--' for falsy values
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted time (e.g., "3:45") or "--:--"
 */
export function formatDurationDash(seconds) {
  if (!seconds) return '--:--';
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format seconds as a shorthand duration string (e.g., "3d 2h", "45m", "0m")
 * @param {number} seconds - Duration in seconds
 * @returns {string} Shorthand duration string
 */
export function formatDurationShorthand(seconds) {
  if (!seconds || seconds <= 0) return '0m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Format a timestamp as a relative time string (e.g., "5m ago", "3d ago")
 * @param {string|number|Date} timestamp - Timestamp to format
 * @returns {string} Relative time string or '--' for falsy values
 */
export function formatRelativeTime(timestamp) {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
