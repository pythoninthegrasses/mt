import { api } from '../api.js';
import { formatTime } from '../utils/formatting.js';

const { invoke } = window.__TAURI__?.core ??
  { invoke: () => Promise.resolve(console.warn('Tauri not available')) };
const { listen } = window.__TAURI__?.event ?? { listen: () => Promise.resolve(() => {}) };

export function createPlayerStore(Alpine) {
  Alpine.store('player', {
    currentTrack: null,
    isPlaying: false,
    progress: 0,
    currentTime: 0,
    duration: 0,
    volume: 100,
    muted: false,
    isSeeking: false,
    isFavorite: false,
    artwork: null,

    _progressListener: null,
    _trackEndedListener: null,
    _mediaKeyListeners: [],
    _previousVolume: 100,
    _seekDebounce: null,
    _playRequestId: 0, // Guard against concurrent playTrack calls

    async init() {
      this._progressListener = await listen('audio://progress', (event) => {
        if (this.isSeeking) return;
        const { position_ms, duration_ms, state } = event.payload;
        this.currentTime = position_ms;
        // Only update duration if Rust provides a valid value, or we don't have one yet
        // This preserves the database fallback duration for VBR MP3s where rodio can't determine duration
        if (duration_ms > 0 || this.duration === 0) {
          this.duration = duration_ms;
        }
        const effectiveDuration = this.duration;
        this.progress = effectiveDuration > 0 ? (position_ms / effectiveDuration) * 100 : 0;
        this.isPlaying = state === 'Playing';
      });

      this._trackEndedListener = await listen('audio://track-ended', () => {
        this.isPlaying = false;
        Alpine.store('queue').playNext();
      });

      this._mediaKeyListeners = await Promise.all([
        listen('mediakey://play', () => this.resume()),
        listen('mediakey://pause', () => this.pause()),
        listen('mediakey://toggle', () => this.togglePlay()),
        listen('mediakey://next', () => this.next()),
        listen('mediakey://previous', () => this.previous()),
        listen('mediakey://stop', () => this.stop()),
      ]);

      try {
        const status = await invoke('audio_get_status');
        this.volume = Math.round(status.volume * 100);
      } catch (e) {
        console.warn('Could not get initial audio status:', e);
      }
    },

    destroy() {
      if (this._progressListener) this._progressListener();
      if (this._trackEndedListener) this._trackEndedListener();
      this._mediaKeyListeners.forEach((unlisten) => unlisten());
    },

    async playTrack(track) {
      const trackPath = track?.filepath || track?.path;
      if (!trackPath) {
        console.error('Cannot play track without filepath/path:', track);
        return;
      }

      // Increment request ID to mark any pending playTrack as stale
      const requestId = ++this._playRequestId;

      if (track.missing) {
        console.log('[playback]', 'missing_track_attempted', {
          trackId: track.id,
          trackTitle: track.title,
        });
        const result = await Alpine.store('ui').showMissingTrackModal(track);

        if (result.result === 'located' && result.newPath) {
          track = { ...track, filepath: result.newPath, path: result.newPath, missing: false };
        } else {
          return;
        }
      }

      console.log('[playback]', 'play_track', {
        trackId: track.id,
        trackTitle: track.title,
        trackArtist: track.artist,
        trackPath: track.filepath || track.path,
        requestId,
      });

      try {
        // Combined load+play in a single IPC call to minimize transition gap.
        // engine.load() already stops any current playback internally.
        const info = await invoke('audio_load_and_play', {
          path: track.filepath || track.path,
          trackId: track.id,
        });

        // Check if this request was superseded while loading
        if (this._playRequestId !== requestId) {
          console.log('[playback]', 'request_superseded', {
            requestId,
            currentId: this._playRequestId,
          });
          return;
        }

        const trackDurationMs = track.duration ? Math.round(track.duration * 1000) : 0;
        const durationMs = (info.duration_ms > 0 ? info.duration_ms : trackDurationMs) || 0;
        console.debug('[playTrack] duration sources:', {
          rust: info.duration_ms,
          track: track.duration,
          trackMs: trackDurationMs,
          final: durationMs,
        });
        this.currentTrack = { ...track, duration: durationMs };
        this.duration = durationMs;
        this.currentTime = 0;
        this.progress = 0;
        this.isPlaying = true;

        await this.checkFavoriteStatus();
        await this.loadArtwork();
        await this._updateNowPlayingMetadata();
        await this._updateNowPlayingState();
      } catch (error) {
        // Only log error if this request is still current
        if (this._playRequestId === requestId) {
          console.error('[playback]', 'play_track_error', {
            trackId: track.id,
            error: error.message,
          });
          this.isPlaying = false;
        }
      }
    },

    async pause() {
      console.log('[playback]', 'pause', {
        trackId: this.currentTrack?.id,
        currentTime: this.currentTime,
      });

      try {
        await invoke('audio_pause');
        this.isPlaying = false;
        await this._updateNowPlayingState();
      } catch (error) {
        console.error('[playback]', 'pause_error', { error: error.message });
      }
    },

    async resume() {
      console.log('[playback]', 'resume', {
        trackId: this.currentTrack?.id,
        currentTime: this.currentTime,
      });

      try {
        await invoke('audio_play');
        this.isPlaying = true;
        await this._updateNowPlayingState();
      } catch (error) {
        console.error('[playback]', 'resume_error', { error: error.message });
      }
    },

    async togglePlay() {
      console.log('[playback]', 'toggle_play', {
        currentlyPlaying: this.isPlaying,
        hasTrack: !!this.currentTrack,
      });

      if (this.isPlaying) {
        await this.pause();
      } else if (this.currentTrack) {
        await this.resume();
      } else {
        const queue = Alpine.store('queue');
        if (queue.items.length > 0) {
          const idx = queue.currentIndex >= 0 ? queue.currentIndex : 0;
          await queue.playIndex(idx);
        } else {
          const library = Alpine.store('library');
          if (library.filteredTracks.length > 0) {
            await queue.add(library.filteredTracks, true);
          }
        }
      }
    },

    async previous() {
      console.log('[playback]', 'previous', {
        currentTrackId: this.currentTrack?.id,
      });
      await Alpine.store('queue').skipPrevious();
    },

    async next() {
      console.log('[playback]', 'next', {
        currentTrackId: this.currentTrack?.id,
      });
      await Alpine.store('queue').skipNext();
    },

    async stop() {
      console.log('[playback]', 'stop', {
        trackId: this.currentTrack?.id,
      });

      try {
        await invoke('audio_stop');
        this.isPlaying = false;
        this.progress = 0;
        this.currentTime = 0;
        this.currentTrack = null;
        await invoke('media_set_stopped').catch(() => {});
      } catch (error) {
        console.error('[playback]', 'stop_error', { error: error.message });
      }
    },

    seek(positionMs) {
      // Handle NaN/Infinity
      if (!Number.isFinite(positionMs)) {
        positionMs = 0;
      }

      if (this._seekDebounce) {
        clearTimeout(this._seekDebounce);
      }

      // Clamp to [0, duration]
      const pos = Math.max(0, Math.min(Math.round(positionMs), this.duration));
      this.isSeeking = true;
      this.currentTime = pos;
      this.progress = this.duration > 0 ? (pos / this.duration) * 100 : 0;

      console.log('[playback]', 'seek', {
        trackId: this.currentTrack?.id,
        positionMs: pos,
        progressPercent: this.progress.toFixed(1),
      });

      this._seekDebounce = setTimeout(async () => {
        try {
          await invoke('audio_seek', { positionMs: pos });
        } catch (error) {
          console.error('[playback]', 'seek_error', { error: error.message, positionMs: pos });
        } finally {
          this.isSeeking = false;
          this._seekDebounce = null;
        }
      }, 50);
    },

    async seekPercent(percent) {
      if (!Number.isFinite(percent)) return;
      if (!this.duration || this.duration <= 0) return;
      const positionMs = Math.round((percent / 100) * this.duration);
      await this.seek(positionMs);
    },

    async setVolume(vol) {
      const clampedVol = Math.max(0, Math.min(100, vol));

      console.log('[playback]', 'set_volume', {
        volume: clampedVol,
        previousVolume: this.volume,
      });

      // Update volume optimistically for immediate UI feedback
      this.volume = clampedVol;

      try {
        await invoke('audio_set_volume', { volume: clampedVol / 100 });
        if (clampedVol > 0) {
          this.muted = false;
        }
      } catch (error) {
        console.error('[playback]', 'set_volume_error', {
          error: error.message,
          volume: clampedVol,
        });
      }
    },

    async toggleMute() {
      console.log('[playback]', 'toggle_mute', {
        currentlyMuted: this.muted,
        currentVolume: this.volume,
      });

      if (this.muted) {
        await this.setVolume(this._previousVolume || 100);
        this.muted = false;
      } else {
        this._previousVolume = this.volume;
        await this.setVolume(0);
        this.muted = true;
      }
    },

    async checkFavoriteStatus() {
      if (!this.currentTrack?.id) {
        this.isFavorite = false;
        return;
      }

      try {
        const result = await api.favorites.check(this.currentTrack.id);
        this.isFavorite = result.is_favorite;
      } catch (error) {
        console.error('Failed to check favorite status:', error);
        this.isFavorite = false;
      }
    },

    async toggleFavorite() {
      if (!this.currentTrack?.id) return;

      console.log('[playback]', 'toggle_favorite', {
        trackId: this.currentTrack.id,
        trackTitle: this.currentTrack.title,
        currentlyFavorite: this.isFavorite,
        action: this.isFavorite ? 'remove' : 'add',
      });

      try {
        if (this.isFavorite) {
          await api.favorites.remove(this.currentTrack.id);
          this.isFavorite = false;
        } else {
          await api.favorites.add(this.currentTrack.id);
          this.isFavorite = true;
        }

        Alpine.store('library').refreshIfLikedSongs();
      } catch (error) {
        console.error('[playback]', 'toggle_favorite_error', {
          trackId: this.currentTrack.id,
          error: error.message,
        });
      }
    },

    async loadArtwork() {
      if (!this.currentTrack?.id) {
        this.artwork = null;
        return;
      }

      try {
        this.artwork = await api.library.getArtwork(this.currentTrack.id);
      } catch (error) {
        // Silently fail if artwork not found (404 is expected for tracks without artwork)
        if (error.status !== 404) {
          console.error('Failed to load artwork:', error);
        }
        this.artwork = null;
      }
    },

    async _updateNowPlayingMetadata() {
      if (!this.currentTrack) return;

      try {
        await invoke('media_set_metadata', {
          title: this.currentTrack.title || null,
          artist: this.currentTrack.artist || null,
          album: this.currentTrack.album || null,
          durationMs: this.duration || null,
          coverUrl: null,
        });
      } catch (error) {
        console.warn('Failed to update Now Playing metadata:', error);
      }

      // Update Last.fm Now Playing in background
      this._updateLastfmNowPlaying();
    },

    _updateLastfmNowPlaying() {
      if (!this.currentTrack) return;

      try {
        const nowPlayingData = {
          artist: this.currentTrack.artist || 'Unknown Artist',
          track: this.currentTrack.title || 'Unknown Track',
          album: this.currentTrack.album || undefined,
          duration: Math.floor(this.duration / 1000), // Convert ms to seconds
        };

        api.lastfm.updateNowPlaying(nowPlayingData).then((result) => {
          if (result.status === 'disabled' || result.status === 'not_authenticated') {
            // Silently ignore if not configured
            return;
          }
          console.debug('[lastfm] Now Playing updated:', nowPlayingData.track);
        }).catch((error) => {
          console.warn('[lastfm] Failed to update Now Playing:', error);
        });
      } catch (error) {
        // Silently ignore Now Playing errors
        console.warn('[lastfm] Error preparing Now Playing data:', error);
      }
    },

    async _updateNowPlayingState() {
      try {
        if (this.isPlaying) {
          await invoke('media_set_playing', { progressMs: this.currentTime || null });
        } else {
          await invoke('media_set_paused', { progressMs: this.currentTime || null });
        }
      } catch (error) {
        console.warn('Failed to update Now Playing state:', error);
      }
    },

    get formattedCurrentTime() {
      return formatTime(this.currentTime);
    },

    get formattedDuration() {
      return formatTime(this.duration);
    },
  });
}
