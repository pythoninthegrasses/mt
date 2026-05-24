/**
 * Player Controls Component
 *
 * Bottom player controls bar with transport controls, progress bar,
 * volume control, and now playing info.
 */

import { computeLibraryStats } from '../utils/library-stats.js';

/**
 * Create the player controls Alpine component
 * @param {object} Alpine - Alpine.js instance
 */
export function createPlayerControls(Alpine) {
  Alpine.data('playerControls', () => ({
    // Local state for drag operations
    isDraggingProgress: false,
    isDraggingVolume: false,
    dragPosition: 0,
    dragVolume: 0,
    showVolumeTooltip: false,
    _volumeDebounce: null,

    init() {
      document.addEventListener('mouseup', () => {
        if (this.isDraggingProgress) {
          this.isDraggingProgress = false;
          this.player.seek(this.dragPosition);
        }
        if (this.isDraggingVolume) {
          // Commit immediately on mouseup to prevent bounce-back
          if (this._volumeDebounce) {
            clearTimeout(this._volumeDebounce);
            this._volumeDebounce = null;
          }
          this.player.setVolume(this.dragVolume);
          this.isDraggingVolume = false;
        }
      });

      document.addEventListener('mousemove', (event) => {
        if (this.isDraggingVolume) {
          this.updateDragVolume(event);
        }
      });
    },

    /**
     * Get the player store
     */
    get player() {
      return this.$store.player;
    },

    /**
     * Get the queue store
     */
    get queue() {
      return this.$store.queue;
    },

    /**
     * Get the UI store
     */
    get ui() {
      return this.$store.ui;
    },

    /**
     * Get current track
     */
    get currentTrack() {
      return this.player.currentTrack;
    },

    get hasTrack() {
      return !!this.currentTrack;
    },

    get isFavorite() {
      return this.player.isFavorite;
    },

    toggleFavorite() {
      if (!this.hasTrack) return;
      this.player.toggleFavorite();
    },

    get trackDisplayName() {
      if (!this.currentTrack) return '';
      const artist = this.currentTrack.artist || 'Unknown Artist';
      const title = this.currentTrack.title || this.currentTrack.filename || 'Unknown Track';
      return `${artist} - ${title}`;
    },

    get playIcon() {
      return this.player.isPlaying ? 'pause' : 'play';
    },

    /**
     * Get volume icon based on level
     */
    get volumeIcon() {
      if (this.player.muted || this.player.volume === 0) {
        return 'muted';
      } else if (this.player.volume < 33) {
        return 'low';
      } else if (this.player.volume < 66) {
        return 'medium';
      }
      return 'high';
    },

    /**
     * Get loop icon based on mode
     */
    get loopIcon() {
      return this.queue.loop === 'one' ? 'repeat-one' : 'repeat';
    },

    /**
     * Check if loop is active
     */
    get isLoopActive() {
      return this.queue.loop !== 'none';
    },

    /**
     * Check if shuffle is active
     */
    get isShuffleActive() {
      return this.queue.shuffle;
    },

    get displayPosition() {
      if (this.isDraggingProgress) {
        return this.dragPosition;
      }
      return this.player.currentTime;
    },

    get progressPercent() {
      if (!this.player.duration) return 0;
      return (this.displayPosition / this.player.duration) * 100;
    },

    /**
     * Handle play/pause toggle
     */
    togglePlay() {
      this.player.togglePlay();
    },

    /**
     * Handle previous track
     */
    previous() {
      this.player.previous();
    },

    /**
     * Handle next track
     */
    next() {
      this.player.next();
    },

    handleProgressClick(event) {
      if (!this.hasTrack) return;
      if (!this.player.duration || this.player.duration <= 0) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const position = Math.round(percent * this.player.duration);

      if (isNaN(position) || position < 0) return;
      this.player.seek(position);
    },

    /**
     * Handle progress bar drag start
     * @param {MouseEvent} event
     */
    handleProgressDragStart(event) {
      if (!this.hasTrack) return;

      this.isDraggingProgress = true;
      this.updateDragPosition(event);
    },

    /**
     * Handle progress bar drag
     * @param {MouseEvent} event
     */
    handleProgressDrag(event) {
      if (!this.isDraggingProgress) return;
      this.updateDragPosition(event);
    },

    updateDragPosition(event) {
      const progressBar = this.$refs.progressBar;
      if (!progressBar) return;
      if (!this.player.duration || this.player.duration <= 0) return;

      const rect = progressBar.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const position = Math.round(percent * this.player.duration);

      if (!isNaN(position) && position >= 0) {
        this.dragPosition = position;
      }
    },

    handleVolumeChange(event) {
      const value = parseInt(event.target.value, 10);
      this.commitVolume(value);
    },

    handleVolumeClick(event) {
      const rect = event.currentTarget.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const volume = Math.round(percent * 100);
      this.commitVolume(volume);
    },

    handleVolumeDragStart(event) {
      this.isDraggingVolume = true;
      this.updateDragVolume(event);
    },

    updateDragVolume(event) {
      const volumeBar = this.$refs.volumeBar;
      if (!volumeBar) return;

      const rect = volumeBar.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      this.dragVolume = Math.round(percent * 100);
    },

    commitVolume(volume) {
      if (this._volumeDebounce) {
        clearTimeout(this._volumeDebounce);
      }

      this._volumeDebounce = setTimeout(() => {
        this.player.setVolume(volume);
        this._volumeDebounce = null;
      }, 30);
    },

    get displayVolume() {
      return this.isDraggingVolume ? this.dragVolume : this.player.volume;
    },

    get volumeTooltipText() {
      return `${this.displayVolume}%`;
    },

    /**
     * Toggle mute
     */
    toggleMute() {
      this.player.toggleMute();
    },

    /**
     * Toggle shuffle
     */
    toggleShuffle() {
      this.queue.toggleShuffle();
    },

    /**
     * Cycle loop mode
     */
    cycleLoop() {
      this.queue.cycleLoop();
    },

    /**
     * Toggle queue view
     */
    toggleQueue() {
      if (this.ui.view === 'queue') {
        this.ui.setView('library');
      } else {
        this.ui.setView('queue');
      }
    },

    /**
     * Show now playing view
     */
    showNowPlaying() {
      this.ui.setView('nowPlaying');
    },

    /**
     * Jump to current track in the active view's track list
     */
    jumpToCurrentTrack() {
      if (!this.currentTrack) return;
      if (this.ui.view === 'library') {
        window.dispatchEvent(new CustomEvent('mt:scroll-to-current-track'));
      } else if (this.ui.view === 'nowPlaying') {
        window.dispatchEvent(new CustomEvent('mt:scroll-to-current-in-queue'));
      }
    },

    get library() {
      return this.$store.library;
    },

    get libraryStats() {
      return computeLibraryStats(
        this.library.localFileCount,
        this.library.totalDuration,
        this.library.totalFileSize,
      );
    },
  }));
}

export default createPlayerControls;
