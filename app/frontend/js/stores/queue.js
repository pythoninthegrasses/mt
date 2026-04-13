/**
 * Queue Store - manages playback queue state
 *
 * The queue maintains tracks in PLAY ORDER - the order shown in the Now Playing
 * view is always the order tracks will be played. When shuffle is enabled,
 * the items array is physically reordered.
 *
 * State machine logic (shuffle, navigation, play-next, history, integrity)
 * lives in the Rust backend. This store is a thin reactive layer that:
 * 1. Calls backend commands for state transitions
 * 2. Applies returned state snapshots
 * 3. Exposes computed UI properties
 */

import { queue as queueApi } from '../api/queue.js';

export function createQueueStore(Alpine) {
  Alpine.store('queue', {
    // Queue items - always in play order
    items: [], // Array of track objects in the order they will play
    currentIndex: -1, // Currently playing index (-1 = none)

    // Playback modes
    shuffle: false,
    loop: 'none', // 'none', 'all', 'one'
    stopAfterCurrent: false, // Stop playback when current track ends

    // Loading state
    loading: false,

    // Flag to prevent event listener from overriding during initialization
    _initializing: false,

    // Flag to prevent event listener from overriding during queue operations
    _updating: false,

    /**
     * Initialize queue from backend
     */
    async init() {
      this._initializing = true;
      try {
        // Clear queue on startup (session-only, like shuffle/loop/currentIndex)
        await this.clear();
        await this._initPlaybackState();
      } finally {
        // Use a small delay to ensure backend events from initialization have been processed
        setTimeout(() => {
          this._initializing = false;
        }, 100);
      }
    },

    /**
     * Initialize playback state (session-only, resets on app start)
     */
    async _initPlaybackState() {
      // Reset to defaults - shuffle, loop, and currentIndex are session-only
      this.currentIndex = -1;
      this.shuffle = false;
      this.loop = 'none';

      // Persist the reset state to backend
      try {
        await queueApi.setCurrentIndex(this.currentIndex);
        await queueApi.setShuffle(this.shuffle);
        await queueApi.setLoop(this.loop);
      } catch (error) {
        console.error('Failed to initialize playback state:', error);
      }
    },

    async load() {
      this.loading = true;
      try {
        const data = await queueApi.get();
        const rawItems = data.items || [];
        this.items = rawItems.map((item) => item.track || item);
        this.currentIndex = data.currentIndex ?? -1;
      } catch (error) {
        console.error('Failed to load queue:', error);
      } finally {
        this.loading = false;
      }
    },

    /**
     * Refresh queue from backend (alias for load)
     * Called by event system when external changes are detected
     */
    async refresh() {
      await this.load();
    },

    /**
     * Handle external queue updates from Tauri events
     * @param {string} action - Type of update: 'added', 'removed', 'cleared', 'reordered', 'shuffled'
     * @param {Array|null} positions - Affected positions (if applicable)
     * @param {number} queueLength - New queue length
     */
    handleExternalUpdate(action, positions, queueLength) {
      console.log('[queue] External update:', action, positions, queueLength);

      // Preserve current playback state during refresh
      const currentTrackId = this.currentIndex >= 0 ? this.items[this.currentIndex]?.id : null;

      // Refresh queue from backend
      this._refreshPreservingIndex(currentTrackId);
    },

    /**
     * Refresh queue from backend while preserving currentIndex if possible
     * @param {number|null} currentTrackId - ID of currently playing track to find after refresh
     */
    async _refreshPreservingIndex(currentTrackId) {
      this.loading = true;
      try {
        const data = await queueApi.get();
        const rawItems = data.items || [];
        this.items = rawItems.map((item) => item.track || item);

        // Restore currentIndex by finding the currently playing track
        if (currentTrackId !== null) {
          const newIndex = this.items.findIndex((t) => t.id === currentTrackId);
          if (newIndex >= 0) {
            this.currentIndex = newIndex;
          } // If track not found, keep current index if still valid, else reset
          else if (this.currentIndex >= this.items.length) {
            this.currentIndex = this.items.length > 0 ? this.items.length - 1 : -1;
          }
        } else if (this.items.length === 0) {
          this.currentIndex = -1;
        }
      } catch (error) {
        console.error('Failed to refresh queue:', error);
      } finally {
        this.loading = false;
      }
    },

    /**
     * Apply a state snapshot from the backend
     * @param {Object} snapshot - QueueStateSnapshot from backend
     */
    _applySnapshot(snapshot) {
      if (!snapshot) return;
      this.items = (snapshot.items || []).map((item) => item.track || item);
      this.currentIndex = snapshot.current_index ?? this.currentIndex;
      this.shuffle = snapshot.shuffle_enabled ?? this.shuffle;
      this.loop = snapshot.loop_mode ?? this.loop;
    },

    /**
     * Apply a navigation result from the backend
     * @param {Object} result - QueueNavigationResult from backend
     * @returns {string} The action taken: 'play', 'stop', or 'seek_zero'
     */
    async _applyNavigationResult(result) {
      if (!result) return 'stop';

      this._applySnapshot(result.snapshot);

      if (result.action === 'play' && result.track) {
        Alpine.store('player').updateTrackState(result.track, result.duration_ms);
      }

      return result.action;
    },

    /**
     * Add tracks to queue
     * @param {Array|Object} tracks - Track(s) to add
     * @param {boolean} playNow - Start playing immediately
     */
    async add(tracks, playNow = false) {
      const tracksArray = Array.isArray(tracks) ? tracks : [tracks];
      const startIndex = this.items.length;

      console.log('[queue]', 'add_tracks', {
        count: tracksArray.length,
        trackIds: tracksArray.map((t) => t.id),
        playNow,
        queueSizeBefore: this.items.length,
      });

      // Update local state
      this.items.push(...tracksArray);

      // Persist to backend
      try {
        const trackIds = tracksArray.map((t) => t.id);
        await queueApi.add(trackIds);
      } catch (error) {
        console.error('[queue] Failed to persist add:', error);
      }

      if (playNow && tracksArray.length > 0) {
        await this.playIndex(startIndex);
      }
    },

    /**
     * Add multiple tracks to end of queue (batch add)
     * Alias for add() but more explicit for batch operations
     * @param {Array} tracks - Array of track objects to add
     * @param {boolean} playNow - Start playing immediately
     */
    async addTracks(tracks, playNow = false) {
      await this.add(tracks, playNow);
    },

    /**
     * Insert tracks at specific position
     * @param {number} index - Position to insert at
     * @param {Array|Object} tracks - Track(s) to insert
     */
    async insert(index, tracks) {
      const tracksArray = Array.isArray(tracks) ? tracks : [tracks];

      console.log('[queue]', 'insert_tracks', {
        count: tracksArray.length,
        trackIds: tracksArray.map((t) => t.id),
        insertIndex: index,
        currentIndex: this.currentIndex,
      });

      // Prevent QUEUE_STATE_CHANGED event from overwriting state during insert
      this._updating = true;

      try {
        // Update local state
        this.items.splice(index, 0, ...tracksArray);

        // Adjust current index if needed
        if (this.currentIndex >= index) {
          this.currentIndex += tracksArray.length;
        }

        // Persist to backend
        try {
          const trackIds = tracksArray.map((t) => t.id);
          await queueApi.add(trackIds, index);
        } catch (error) {
          console.error('[queue] Failed to persist insert:', error);
        }
      } finally {
        setTimeout(() => {
          this._updating = false;
        }, 50);
      }
    },

    /**
     * Insert tracks to play next (after currently playing track).
     * Backend handles move semantics, offset tracking, and play-next ID management.
     * @param {Array|Object} tracks - Track(s) to insert
     */
    async playNextTracks(tracks) {
      const tracksArray = Array.isArray(tracks) ? tracks : [tracks];
      if (tracksArray.length === 0) return;

      console.log('[queue]', 'play_next_tracks', {
        count: tracksArray.length,
        trackIds: tracksArray.map((t) => t.id),
      });

      this._updating = true;
      try {
        const trackIds = tracksArray.map((t) => t.id);
        const snapshot = await queueApi.addPlayNext(trackIds);
        this._applySnapshot(snapshot);
      } catch (error) {
        console.error('[queue] Failed to add play-next:', error);
      } finally {
        setTimeout(() => {
          this._updating = false;
        }, 50);
      }
    },

    /**
     * Remove track at index
     * @param {number} index - Index to remove
     */
    async remove(index) {
      if (index < 0 || index >= this.items.length) return;

      // Prevent QUEUE_STATE_CHANGED event from overwriting state during remove
      this._updating = true;

      try {
        const removedTrack = this.items[index];
        console.log('[queue]', 'remove_track', {
          index,
          trackId: removedTrack?.id,
          trackTitle: removedTrack?.title,
          wasCurrentTrack: index === this.currentIndex,
          queueSizeBefore: this.items.length,
        });

        // Update local state
        this.items.splice(index, 1);

        // Adjust current index
        if (index < this.currentIndex) {
          this.currentIndex--;
        } else if (index === this.currentIndex) {
          // Currently playing track was removed
          if (this.items.length === 0) {
            this.currentIndex = -1;
            Alpine.store('player')?.stop();
          } else if (this.currentIndex >= this.items.length) {
            this.currentIndex = this.items.length - 1;
          }
        }

        // Persist to backend
        try {
          await queueApi.remove(index);
          await queueApi.setCurrentIndex(this.currentIndex);
        } catch (error) {
          console.error('[queue] Failed to persist remove:', error);
        }
      } finally {
        setTimeout(() => {
          this._updating = false;
        }, 50);
      }
    },

    async clear() {
      console.log('[queue]', 'clear', {
        previousSize: this.items.length,
        hadCurrentTrack: this.currentIndex >= 0,
      });

      // Update local state
      this.items = [];
      this.currentIndex = -1;

      Alpine.store('player')?.stop();

      // Persist to backend
      try {
        await queueApi.clear();
      } catch (error) {
        console.error('[queue] Failed to persist clear:', error);
      }
    },

    /**
     * Reorder track in queue (drag and drop)
     * @param {number} from - Source index
     * @param {number} to - Destination index
     */
    async reorder(from, to) {
      if (from === to) return;
      if (from < 0 || from >= this.items.length) return;
      if (to < 0 || to >= this.items.length) return;

      const track = this.items[from];
      console.log('[queue]', 'reorder_track', {
        from,
        to,
        trackId: track?.id,
        trackTitle: track?.title,
        wasCurrentTrack: from === this.currentIndex,
      });

      // Update local state
      const [item] = this.items.splice(from, 1);
      this.items.splice(to, 0, item);

      // Adjust current index
      if (from === this.currentIndex) {
        this.currentIndex = to;
      } else if (from < this.currentIndex && to >= this.currentIndex) {
        this.currentIndex--;
      } else if (from > this.currentIndex && to <= this.currentIndex) {
        this.currentIndex++;
      }

      // Persist to backend
      try {
        await queueApi.move(from, to);
      } catch (error) {
        console.error('[queue] Failed to persist reorder:', error);
      }
    },

    /**
     * Play track at specific index
     * @param {number} index - Index to play
     * @param {boolean} fromNavigation - If true, this is from backend navigation (history already handled)
     */
    async playIndex(index, fromNavigation = false) {
      if (index < 0 || index >= this.items.length) return;

      this.currentIndex = index;
      const track = this.items[index];

      await Alpine.store('player').playTrack(track);
      await queueApi.setCurrentIndex(this.currentIndex);
    },

    /**
     * Play next track. Backend handles repeat-one two-phase, loop modes,
     * history push, reshuffle on loop restart, and audio playback.
     */
    async playNext() {
      if (this.items.length === 0) return;

      // Stop after current track if flag is set (frontend-only concern)
      if (this.stopAfterCurrent) {
        this.stopAfterCurrent = false;
        Alpine.store('player').isPlaying = false;
        return;
      }

      this._updating = true;
      try {
        const result = await queueApi.playNextTrack();
        const action = await this._applyNavigationResult(result);

        if (action === 'stop') {
          Alpine.store('player').isPlaying = false;
        }
      } catch (error) {
        console.error('[queue] playNext failed:', error);
      } finally {
        setTimeout(() => {
          this._updating = false;
        }, 50);
      }
    },

    /**
     * Play previous track. Backend handles >3sec restart, history pop,
     * fallback decrement, and loop wraparound.
     */
    async playPrevious() {
      if (this.items.length === 0) return;

      this._updating = true;
      try {
        const player = Alpine.store('player');
        const currentTimeMs = player.currentTime || 0;
        const result = await queueApi.playPreviousTrack(currentTimeMs);
        const action = await this._applyNavigationResult(result);

        if (action === 'seek_zero') {
          await player.seek(0);
        }
      } catch (error) {
        console.error('[queue] playPrevious failed:', error);
      } finally {
        setTimeout(() => {
          this._updating = false;
        }, 50);
      }
    },

    /**
     * Manual skip to next track (user-initiated).
     * Backend overrides repeat-one mode before advancing.
     */
    async skipNext() {
      this._updating = true;
      try {
        const result = await queueApi.skipNext();
        const action = await this._applyNavigationResult(result);

        if (action === 'stop') {
          Alpine.store('player').isPlaying = false;
        }
      } catch (error) {
        console.error('[queue] skipNext failed:', error);
      } finally {
        setTimeout(() => {
          this._updating = false;
        }, 50);
      }
    },

    /**
     * Manual skip to previous track (user-initiated).
     * Backend overrides repeat-one mode before going back.
     */
    async skipPrevious() {
      this._updating = true;
      try {
        const player = Alpine.store('player');
        const currentTimeMs = player.currentTime || 0;
        const result = await queueApi.skipPrevious(currentTimeMs);
        const action = await this._applyNavigationResult(result);

        if (action === 'seek_zero') {
          await player.seek(0);
        }
      } catch (error) {
        console.error('[queue] skipPrevious failed:', error);
      } finally {
        setTimeout(() => {
          this._updating = false;
        }, 50);
      }
    },

    /**
     * Toggle shuffle on/off. Backend handles Fisher-Yates, original order
     * save/restore, play-next pinning, and current-track-at-index-0.
     */
    async toggleShuffle() {
      this._updating = true;
      try {
        const snapshot = await queueApi.setShuffle(!this.shuffle);
        this._applySnapshot(snapshot);
      } catch (error) {
        console.error('[queue] toggleShuffle failed:', error);
      } finally {
        setTimeout(() => {
          this._updating = false;
        }, 50);
      }
    },

    async shuffleQueue() {
      if (this.items.length < 2) return;

      console.log('[queue]', 'shuffle', {
        queueSize: this.items.length,
        currentIndex: this.currentIndex,
      });

      try {
        await queueApi.shuffle(true);
        await this.load();
      } catch (error) {
        console.error('[queue] shuffleQueue failed:', error);
      }
    },

    async cycleLoop() {
      const modes = ['none', 'all', 'one'];
      const currentIdx = modes.indexOf(this.loop);
      const newMode = modes[(currentIdx + 1) % modes.length];

      console.log('[queue]', 'cycle_loop', {
        previousMode: this.loop,
        newMode,
      });

      this.loop = newMode;
      await queueApi.setLoop(this.loop);
    },

    /**
     * Set loop mode directly
     * @param {string} mode - 'none', 'all', or 'one'
     */
    async setLoop(mode) {
      if (['none', 'all', 'one'].includes(mode)) {
        console.log('[queue]', 'set_loop', {
          previousMode: this.loop,
          newMode: mode,
        });

        this.loop = mode;
        await queueApi.setLoop(this.loop);
      }
    },

    /**
     * Run integrity check via backend
     */
    async checkIntegrity() {
      try {
        const report = await queueApi.checkIntegrity();
        if (report.repaired) {
          console.log('[queue] Integrity check repaired issues:', report);
          await this.load();
        }
        return report;
      } catch (error) {
        console.error('[queue] Integrity check failed:', error);
        return null;
      }
    },

    /**
     * Get tracks (alias for items, used by UI templates)
     */
    get tracks() {
      return this.items;
    },

    /**
     * Get current track
     */
    get currentTrack() {
      return this.currentIndex >= 0 ? this.items[this.currentIndex] : null;
    },

    /**
     * Check if there's a next track
     */
    get hasNext() {
      if (this.items.length === 0) return false;
      if (this.loop !== 'none') return true;
      return this.currentIndex < this.items.length - 1;
    },

    /**
     * Check if there's a previous track
     */
    get hasPrevious() {
      if (this.items.length === 0) return false;
      if (this.loop !== 'none') return true;
      return this.currentIndex > 0;
    },

    /**
     * Get loop icon for UI
     */
    get loopIcon() {
      switch (this.loop) {
        case 'one':
          return 'repeat-1';
        case 'all':
          return 'repeat';
        default:
          return 'repeat';
      }
    },

    get playOrderItems() {
      if (this.items.length === 0) return [];

      const current = this.currentIndex >= 0 ? this.currentIndex : 0;
      const result = [];

      // Show current track + upcoming tracks
      for (let i = current; i < this.items.length; i++) {
        result.push({
          track: this.items[i],
          originalIndex: i,
          isCurrentTrack: i === this.currentIndex,
          isUpcoming: i > this.currentIndex,
        });
      }

      // If loop=all, append tracks from beginning up to current
      if (this.loop === 'all' && current > 0) {
        for (let i = 0; i < current; i++) {
          result.push({
            track: this.items[i],
            originalIndex: i,
            isCurrentTrack: false,
            isUpcoming: true,
          });
        }
      }

      return result;
    },

    /**
     * Get upcoming tracks only (excludes current track)
     */
    get upcomingTracks() {
      return this.playOrderItems.filter((item) => item.isUpcoming);
    },
  });
}
