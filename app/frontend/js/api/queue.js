/**
 * Queue API
 *
 * Playback queue management: add, remove, reorder, shuffle, and state.
 */

import { request, tauriInvoke } from './shared.js';

export const queue = {
  /**
   * Get current queue (uses Tauri command)
   * @returns {Promise<{items: Array, count: number}>} Queue response
   */
  async get() {
    const result = await tauriInvoke('queue_get');
    if (result !== null) return result;
    return request('/queue');
  },

  /**
   * Add track(s) to queue by track IDs (uses Tauri command)
   * @param {number|number[]} trackIds - Track ID(s) to add
   * @param {number} [position] - Position to insert at (end if omitted)
   * @returns {Promise<{added: number, queue_length: number}>}
   */
  async add(trackIds, position) {
    const ids = Array.isArray(trackIds) ? trackIds : [trackIds];
    const result = await tauriInvoke('queue_add', {
      trackIds: ids,
      position: position ?? null,
    });
    if (result !== null) return result;
    return request('/queue/add', {
      method: 'POST',
      body: JSON.stringify({ track_ids: ids, position }),
    });
  },

  /**
   * Add files directly to queue (for drag-and-drop) (uses Tauri command)
   * @param {string[]} filepaths - File paths to add
   * @param {number} [position] - Position to insert at (end if omitted)
   * @returns {Promise<{added: number, queue_length: number, tracks: Array}>}
   */
  async addFiles(filepaths, position) {
    const result = await tauriInvoke('queue_add_files', {
      filepaths,
      position: position ?? null,
    });
    if (result !== null) return result;
    return request('/queue/add-files', {
      method: 'POST',
      body: JSON.stringify({ filepaths, position }),
    });
  },

  /**
   * Remove track from queue (uses Tauri command)
   * @param {number} position - Position in queue to remove
   * @returns {Promise<void>}
   */
  async remove(position) {
    const result = await tauriInvoke('queue_remove', { position });
    if (result !== null) return result;
    return request(`/queue/${position}`, {
      method: 'DELETE',
    });
  },

  /**
   * Clear the entire queue (uses Tauri command)
   * @returns {Promise<void>}
   */
  async clear() {
    const result = await tauriInvoke('queue_clear');
    if (result !== null) return result;
    return request('/queue/clear', {
      method: 'POST',
    });
  },

  /**
   * Move track within queue (reorder) (uses Tauri command)
   * @param {number} from - Current position
   * @param {number} to - New position
   * @returns {Promise<{success: boolean, queue_length: number}>}
   */
  async move(from, to) {
    const result = await tauriInvoke('queue_reorder', {
      fromPosition: from,
      toPosition: to,
    });
    if (result !== null) return result;

    return request('/queue/reorder', {
      method: 'POST',
      body: JSON.stringify({ from_position: from, to_position: to }),
    });
  },

  /**
   * Shuffle the queue (uses Tauri command)
   * @param {boolean} [keepCurrent=true] - Keep currently playing track at position 0
   * @returns {Promise<{success: boolean, queue_length: number}>}
   */
  async shuffle(keepCurrent = true) {
    const result = await tauriInvoke('queue_shuffle', { keepCurrent });
    if (result !== null) return result;
    return request('/queue/shuffle', {
      method: 'POST',
      body: JSON.stringify({ keep_current: keepCurrent }),
    });
  },

  /**
   * Atomically replace the queue and start playback (single IPC round-trip).
   * Clears the queue, installs all tracks (rotated or shuffled), triggers
   * audio playback on the start track, and returns the new queue state.
   * @param {number[]} trackIds - Track IDs in album/view order
   * @param {number} startIndex - Index of the track to play first
   * @param {boolean} shuffle - Whether to shuffle the queue
   * @returns {Promise<{items: Array, current_index: number, track: Object, shuffle_enabled: boolean}>}
   */
  async playContext(trackIds, startIndex, shuffle) {
    const result = await tauriInvoke('queue_play_context', {
      trackIds,
      startIndex,
      shuffle,
    });
    if (result !== null) return result;
    return request('/queue/play-context', {
      method: 'POST',
      body: JSON.stringify({
        track_ids: trackIds,
        start_index: startIndex,
        shuffle,
      }),
    });
  },

  save(state) {
    console.debug('Queue save (local only):', state);
  },

  /**
   * Get queue playback state (uses Tauri command)
   * @returns {Promise<{current_index: number, shuffle_enabled: boolean, loop_mode: string, original_order_json: string|null}>}
   */
  async getPlaybackState() {
    const result = await tauriInvoke('queue_get_playback_state');
    if (result !== null) return result;
    throw new Error('Queue playback state not available in browser mode');
  },

  /**
   * Set current index in queue (uses Tauri command)
   * @param {number} index - New current index
   * @returns {Promise<void>}
   */
  async setCurrentIndex(index) {
    const result = await tauriInvoke('queue_set_current_index', { index });
    if (result !== null) return result;
    console.debug('Queue setCurrentIndex (no-op in browser):', index);
  },

  /**
   * Set shuffle enabled in queue (uses Tauri command)
   * @param {boolean} enabled - Whether shuffle is enabled
   * @returns {Promise<QueueStateSnapshot>} State snapshot with reordered queue
   */
  async setShuffle(enabled) {
    const result = await tauriInvoke('queue_set_shuffle', { enabled });
    if (result !== null) return result;
    console.debug('Queue setShuffle (no-op in browser):', enabled);
  },

  /**
   * Set loop mode in queue (uses Tauri command)
   * @param {string} mode - Loop mode ('none', 'all', 'one')
   * @returns {Promise<void>}
   */
  async setLoop(mode) {
    const result = await tauriInvoke('queue_set_loop', { mode });
    if (result !== null) return result;
    console.debug('Queue setLoop (no-op in browser):', mode);
  },

  /**
   * Add tracks as "play next" with backend-managed offset and move semantics
   * @param {number[]} trackIds - Track IDs to play next
   * @returns {Promise<QueueStateSnapshot>}
   */
  async addPlayNext(trackIds) {
    const result = await tauriInvoke('queue_add_play_next', { trackIds });
    if (result !== null) return result;
    throw new Error('addPlayNext not available in browser mode');
  },

  /**
   * Play next track with full state machine (repeat-one, loop, history, audio)
   * @returns {Promise<QueueNavigationResult>}
   */
  async playNextTrack() {
    const result = await tauriInvoke('queue_play_next_track');
    if (result !== null) return result;
    throw new Error('playNextTrack not available in browser mode');
  },

  /**
   * Play previous track with full state machine (>3sec restart, history, loop wrap)
   * @param {number} currentTimeMs - Current playback position in milliseconds
   * @returns {Promise<QueueNavigationResult>}
   */
  async playPreviousTrack(currentTimeMs) {
    const result = await tauriInvoke('queue_play_previous_track', { currentTimeMs });
    if (result !== null) return result;
    throw new Error('playPreviousTrack not available in browser mode');
  },

  /**
   * Skip to next track, overriding repeat-one mode
   * @returns {Promise<QueueNavigationResult>}
   */
  async skipNext() {
    const result = await tauriInvoke('queue_skip_next');
    if (result !== null) return result;
    throw new Error('skipNext not available in browser mode');
  },

  /**
   * Skip to previous track, overriding repeat-one mode
   * @param {number} currentTimeMs - Current playback position in milliseconds
   * @returns {Promise<QueueNavigationResult>}
   */
  async skipPrevious(currentTimeMs) {
    const result = await tauriInvoke('queue_skip_previous', { currentTimeMs });
    if (result !== null) return result;
    throw new Error('skipPrevious not available in browser mode');
  },

  /**
   * Run queue integrity check and auto-repair
   * @returns {Promise<IntegrityReport>}
   */
  async checkIntegrity() {
    const result = await tauriInvoke('queue_check_integrity');
    if (result !== null) return result;
    throw new Error('checkIntegrity not available in browser mode');
  },
};
