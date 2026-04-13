/**
 * Queue API
 *
 * Playback queue management: add, remove, reorder, shuffle, and state.
 */

import { ApiError, invoke, request } from './shared.js';

export const queue = {
  /**
   * Get current queue (uses Tauri command)
   * @returns {Promise<{items: Array, count: number}>} Queue response
   */
  async get() {
    if (invoke) {
      try {
        return await invoke('queue_get');
      } catch (error) {
        console.error('[api.queue.get] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('queue_add', {
          trackIds: ids,
          position: position ?? null,
        });
      } catch (error) {
        console.error('[api.queue.add] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('queue_add_files', {
          filepaths,
          position: position ?? null,
        });
      } catch (error) {
        console.error('[api.queue.addFiles] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('queue_remove', { position });
      } catch (error) {
        console.error('[api.queue.remove] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request(`/queue/${position}`, {
      method: 'DELETE',
    });
  },

  /**
   * Clear the entire queue (uses Tauri command)
   * @returns {Promise<void>}
   */
  async clear() {
    if (invoke) {
      try {
        return await invoke('queue_clear');
      } catch (error) {
        console.error('[api.queue.clear] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('queue_reorder', {
          fromPosition: from,
          toPosition: to,
        });
      } catch (error) {
        console.error('[api.queue.move] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('queue_shuffle', { keepCurrent });
      } catch (error) {
        console.error('[api.queue.shuffle] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('queue_play_context', {
          trackIds,
          startIndex,
          shuffle,
        });
      } catch (error) {
        console.error('[api.queue.playContext] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
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
    if (invoke) {
      try {
        return await invoke('queue_get_playback_state');
      } catch (error) {
        console.error('[api.queue.getPlaybackState] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    throw new ApiError(500, 'Queue playback state not available in browser mode');
  },

  /**
   * Set current index in queue (uses Tauri command)
   * @param {number} index - New current index
   * @returns {Promise<void>}
   */
  async setCurrentIndex(index) {
    if (invoke) {
      try {
        return await invoke('queue_set_current_index', { index });
      } catch (error) {
        console.error('[api.queue.setCurrentIndex] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    console.debug('Queue setCurrentIndex (no-op in browser):', index);
  },

  /**
   * Set shuffle enabled in queue (uses Tauri command)
   * @param {boolean} enabled - Whether shuffle is enabled
   * @returns {Promise<void>}
   */
  async setShuffle(enabled) {
    if (invoke) {
      try {
        return await invoke('queue_set_shuffle', { enabled });
      } catch (error) {
        console.error('[api.queue.setShuffle] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    console.debug('Queue setShuffle (no-op in browser):', enabled);
  },

  /**
   * Set loop mode in queue (uses Tauri command)
   * @param {string} mode - Loop mode ('none', 'all', 'one')
   * @returns {Promise<void>}
   */
  async setLoop(mode) {
    if (invoke) {
      try {
        return await invoke('queue_set_loop', { mode });
      } catch (error) {
        console.error('[api.queue.setLoop] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    console.debug('Queue setLoop (no-op in browser):', mode);
  },
};
