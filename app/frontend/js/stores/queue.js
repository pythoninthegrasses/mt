/**
 * Queue Store - manages playback queue state
 *
 * The queue maintains tracks in PLAY ORDER - the order shown in the Now Playing
 * view is always the order tracks will be played. When shuffle is enabled,
 * the items array is physically reordered.
 */

import { api } from '../api.js';

export function createQueueStore(Alpine) {
  Alpine.store('queue', {
    // Queue items - always in play order
    items: [], // Array of track objects in the order they will play
    currentIndex: -1, // Currently playing index (-1 = none)

    // Playback modes
    shuffle: false,
    loop: 'none', // 'none', 'all', 'one'

    // Repeat-one "play once more" state
    _repeatOnePending: false,

    // Loading state
    loading: false,

    // Original order preserved for unshuffle
    _originalOrder: [],

    // Play history for prev button navigation
    _playHistory: [],
    _maxHistorySize: 100,

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
      this._originalOrder = [...this.items];
      this._repeatOnePending = false;
      this._playHistory = [];

      // Persist the reset state to backend
      try {
        await api.queue.setCurrentIndex(this.currentIndex);
        await api.queue.setShuffle(this.shuffle);
        await api.queue.setLoop(this.loop);
      } catch (error) {
        console.error('Failed to initialize playback state:', error);
      }
    },

    async load() {
      this.loading = true;
      try {
        const data = await api.queue.get();
        const rawItems = data.items || [];
        this.items = rawItems.map((item) => item.track || item);
        this.currentIndex = data.currentIndex ?? -1;
        this._originalOrder = [...this.items];
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
        const data = await api.queue.get();
        const rawItems = data.items || [];
        this.items = rawItems.map((item) => item.track || item);
        this._originalOrder = [...this.items];

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
     * Save queue state to backend
     */
    async save() {
      try {
        await api.queue.save({
          items: this.items,
          currentIndex: this.currentIndex,
          shuffle: this.shuffle,
          loop: this.loop,
        });
      } catch (error) {
        console.error('Failed to save queue:', error);
      }
    },

    /**
     * Sync full queue state to backend (clear and rebuild)
     * Used when queue order changes in ways that can't be expressed as incremental operations
     */
    async _syncQueueToBackend() {
      try {
        await api.queue.clear();
        if (this.items.length > 0) {
          const trackIds = this.items.map((t) => t.id);
          await api.queue.add(trackIds);
        }
      } catch (error) {
        console.error('[queue] Failed to sync to backend:', error);
      }
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
      this._originalOrder.push(...tracksArray);

      // Persist to backend
      try {
        const trackIds = tracksArray.map((t) => t.id);
        await api.queue.add(trackIds);
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

      // Update local state
      this.items.splice(index, 0, ...tracksArray);

      // Adjust current index if needed
      if (this.currentIndex >= index) {
        this.currentIndex += tracksArray.length;
      }

      // Persist to backend
      try {
        const trackIds = tracksArray.map((t) => t.id);
        await api.queue.add(trackIds, index);
      } catch (error) {
        console.error('[queue] Failed to persist insert:', error);
      }
    },

    /**
     * Insert tracks to play next (after currently playing track)
     * @param {Array|Object} tracks - Track(s) to insert
     */
    async playNextTracks(tracks) {
      const tracksArray = Array.isArray(tracks) ? tracks : [tracks];
      if (tracksArray.length === 0) return;

      // Insert after current track, or at beginning if nothing playing
      const insertIndex = this.currentIndex >= 0 ? this.currentIndex + 1 : 0;

      console.log('[queue]', 'play_next_tracks', {
        count: tracksArray.length,
        trackIds: tracksArray.map((t) => t.id),
        insertIndex,
      });

      await this.insert(insertIndex, tracksArray);
    },

    /**
     * Remove track at index
     * @param {number} index - Index to remove
     */
    async remove(index) {
      if (index < 0 || index >= this.items.length) return;

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
          Alpine.store('player').stop();
        } else if (this.currentIndex >= this.items.length) {
          this.currentIndex = this.items.length - 1;
        }
      }

      // Persist to backend
      try {
        await api.queue.remove(index);
      } catch (error) {
        console.error('[queue] Failed to persist remove:', error);
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
      this._originalOrder = [];
      this._playHistory = [];

      Alpine.store('player').stop();

      // Persist to backend
      try {
        await api.queue.clear();
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
        await api.queue.move(from, to);
      } catch (error) {
        console.error('[queue] Failed to persist reorder:', error);
      }
    },

    /**
     * Play track at specific index
     * @param {number} index - Index to play
     * @param {boolean} fromNavigation - If true, this is from playNext/playPrevious and history shouldn't be cleared
     */
    async playIndex(index, fromNavigation = false) {
      if (index < 0 || index >= this.items.length) return;

      // Clear history on manual jumps (not from prev/next navigation)
      if (!fromNavigation) {
        this._playHistory = [];
      }

      this.currentIndex = index;
      const track = this.items[index];

      await Alpine.store('player').playTrack(track);
      await api.queue.setCurrentIndex(this.currentIndex);
    },

    async playNext() {
      if (this.items.length === 0) return;

      if (this.loop === 'one') {
        if (this._repeatOnePending) {
          this._repeatOnePending = false;
          this.loop = 'none';
          // Loop state is session-only, no persistence needed
        } else {
          this._repeatOnePending = true;
          await this.playIndex(this.currentIndex, true);
          return;
        }
      }

      // Push current track to history before advancing
      if (this.currentIndex >= 0) {
        this._pushToHistory(this.currentIndex);
      }

      let nextIndex = this.currentIndex + 1;

      if (nextIndex >= this.items.length) {
        if (this.loop === 'all') {
          if (this.shuffle) {
            // Use special reshuffle that puts just-played track at END (task-222)
            this._reshuffleForLoopRestart();
          }
          nextIndex = 0;
        } else {
          Alpine.store('player').isPlaying = false;
          return;
        }
      }

      await this.playIndex(nextIndex, true);
    },

    async playPrevious() {
      if (this.items.length === 0) return;

      const player = Alpine.store('player');

      // If > 3 seconds into track, restart current track instead
      if (player.currentTime > 3000) {
        await player.seek(0);
        return;
      }

      // Try to use play history first
      if (this._playHistory.length > 0) {
        const historyEntry = this._popFromHistory();
        await this.playIndex(historyEntry, true);
        return;
      }

      // Fallback: navigate backward in queue array
      let prevIndex = this.currentIndex - 1;

      if (prevIndex < 0) {
        if (this.loop === 'all') {
          prevIndex = this.items.length - 1;
        } else {
          prevIndex = 0;
        }
      }

      await this.playIndex(prevIndex, true);
    },

    /**
     * Manual skip to next track (user-initiated)
     * If in repeat-one mode, reverts to 'all' and skips
     */
    async skipNext() {
      if (this.loop === 'one') {
        this.loop = 'all';
        this._repeatOnePending = false;
        // Loop state is session-only, no persistence needed
      }
      await this._doSkipNext();
    },

    /**
     * Manual skip to previous track (user-initiated)
     * If in repeat-one mode, reverts to 'all' and skips
     */
    async skipPrevious() {
      if (this.loop === 'one') {
        this.loop = 'all';
        this._repeatOnePending = false;
        // Loop state is session-only, no persistence needed
      }
      await this.playPrevious();
    },

    async _doSkipNext() {
      if (this.items.length === 0) return;

      // Push current track to history before advancing (preserves prev button navigation)
      if (this.currentIndex >= 0) {
        this._pushToHistory(this.currentIndex);
      }

      let nextIndex = this.currentIndex + 1;
      if (nextIndex >= this.items.length) {
        nextIndex = 0;
      }

      await this.playIndex(nextIndex, true); // fromNavigation=true preserves history
    },

    async toggleShuffle() {
      // CRITICAL: Prevent QUEUE_STATE_CHANGED event from overwriting state during operation
      this._updating = true;

      try {
        this.shuffle = !this.shuffle;

        if (this.shuffle) {
          // Save original order before shuffling
          this._originalOrder = [...this.items];
          this._shuffleItems();
          // Don't clear history - user can still go back to previously played tracks
          // Don't call setCurrentIndex - same track is playing, just at index 0 now
        } else {
          // Restore original order
          const currentTrack = this.items[this.currentIndex];
          this.items = [...this._originalOrder];
          this.currentIndex = this.items.findIndex((t) => t.id === currentTrack?.id);
          if (this.currentIndex < 0) {
            this.currentIndex = this.items.length > 0 ? 0 : -1;
          }
          // Clear history when disabling shuffle - old indices are now invalid
          this._playHistory = [];
        }

        // Persist shuffle state to backend
        await api.queue.setShuffle(this.shuffle);

        // Only update backend index when disabling shuffle (index changed in original order)
        if (!this.shuffle) {
          await api.queue.setCurrentIndex(this.currentIndex);
        }

        // Sync queue order to backend
        await this._syncQueueToBackend();
      } finally {
        // Delay reset to let pending backend events pass
        setTimeout(() => {
          this._updating = false;
        }, 200);
      }
    },

    _shuffleItems() {
      if (this.items.length < 2) return;

      const currentTrack = this.currentIndex >= 0 ? this.items[this.currentIndex] : null;

      // Filter out current track by index to get tracks to shuffle
      const otherTracks = currentTrack
        ? this.items.filter((_, i) => i !== this.currentIndex)
        : [...this.items];

      // Fisher-Yates shuffle of other tracks
      for (let i = otherTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [otherTracks[i], otherTracks[j]] = [otherTracks[j], otherTracks[i]];
      }

      if (currentTrack) {
        // Current track goes to index 0, shuffled tracks follow (task-213)
        this.items = [currentTrack, ...otherTracks];
        this.currentIndex = 0;
      } else {
        this.items = otherTracks;
      }

      this._validateQueueIntegrity();
    },

    /**
     * Reshuffle for loop restart - ensures just-played track is NOT at index 0 (task-222)
     * Called when loop=all and reaching end of queue with shuffle enabled.
     */
    _reshuffleForLoopRestart() {
      if (this.items.length < 2) return;

      const justPlayedTrack = this.items[this.currentIndex];
      const otherTracks = this.items.filter((_, i) => i !== this.currentIndex);

      // Fisher-Yates shuffle of other tracks
      for (let i = otherTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [otherTracks[i], otherTracks[j]] = [otherTracks[j], otherTracks[i]];
      }

      // Put just-played track at END (plays last in next cycle)
      this.items = [...otherTracks, justPlayedTrack];
      this._originalOrder = [...this.items];

      this._validateQueueIntegrity();
    },

    /**
     * Validate queue integrity - check for duplicate track IDs
     */
    _validateQueueIntegrity() {
      const ids = this.items.map((t) => t.id);
      const uniqueIds = new Set(ids);
      if (uniqueIds.size !== ids.length) {
        console.error('[queue] Duplicate tracks detected!', {
          total: ids.length,
          unique: uniqueIds.size,
        });
        return false;
      }
      return true;
    },

    /**
     * Push index to play history
     * @param {number} index - Index to push to history
     */
    _pushToHistory(index) {
      this._playHistory.push(index);

      // Limit history size to prevent memory issues
      if (this._playHistory.length > this._maxHistorySize) {
        this._playHistory.shift();
      }
    },

    /**
     * Pop index from play history
     * @returns {number} Previous index from history
     */
    _popFromHistory() {
      return this._playHistory.pop();
    },

    async shuffleQueue() {
      if (this.items.length < 2) return;

      console.log('[queue]', 'shuffle', {
        queueSize: this.items.length,
        currentIndex: this.currentIndex,
      });

      // Update local state
      this._shuffleItems();
      this._originalOrder = [...this.items];

      // Sync shuffled order to backend
      await this._syncQueueToBackend();
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
      this._repeatOnePending = false;
      await api.queue.setLoop(this.loop);
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
        this._repeatOnePending = false;
        await api.queue.setLoop(this.loop);
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
