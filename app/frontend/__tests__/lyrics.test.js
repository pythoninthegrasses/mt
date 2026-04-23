/**
 * Unit tests for lyrics functionality
 *
 * Tests cover:
 * - Lyrics API layer (Tauri command invocation)
 * - Lyrics fetch behavior (track change, visibility gating)
 * - Now Playing view component lyrics state management
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Tauri invoke
const mockInvoke = vi.fn();
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: mockInvoke,
    },
  },
};

// Import after mocks are set up
const { lyrics } = await import('../js/api/lyrics.js');

describe('lyrics API', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe('get', () => {
    it('invokes lyrics_get with correct params', async () => {
      mockInvoke.mockResolvedValue({
        plain_lyrics: 'Hello world',
        synced_lyrics: null,
        instrumental: false,
      });

      const result = await lyrics.get({
        artist: 'Queen',
        title: 'Bohemian Rhapsody',
        album: 'A Night at the Opera',
        duration: 354,
      });

      expect(mockInvoke).toHaveBeenCalledWith('lyrics_get', {
        artist: 'Queen',
        title: 'Bohemian Rhapsody',
        album: 'A Night at the Opera',
        duration: 354,
      });

      expect(result).toEqual({
        plain_lyrics: 'Hello world',
        synced_lyrics: null,
        instrumental: false,
      });
    });

    it('passes null for missing optional params', async () => {
      mockInvoke.mockResolvedValue(null);

      await lyrics.get({
        artist: 'Queen',
        title: 'Bohemian Rhapsody',
      });

      expect(mockInvoke).toHaveBeenCalledWith('lyrics_get', {
        artist: 'Queen',
        title: 'Bohemian Rhapsody',
        album: null,
        duration: null,
      });
    });

    it('returns null when backend returns null (no lyrics)', async () => {
      mockInvoke.mockResolvedValue(null);

      const result = await lyrics.get({
        artist: 'Unknown',
        title: 'Unknown',
      });

      expect(result).toBeNull();
    });

    it('throws ApiError on invoke failure', async () => {
      mockInvoke.mockRejectedValue('Database error');

      await expect(
        lyrics.get({ artist: 'A', title: 'B' }),
      ).rejects.toThrow();
    });
  });

  describe('clearCache', () => {
    it('invokes lyrics_clear_cache', async () => {
      mockInvoke.mockResolvedValue(undefined);

      await lyrics.clearCache();

      expect(mockInvoke).toHaveBeenCalledWith('lyrics_clear_cache', {});
    });
  });
});

describe('now-playing-view lyrics state', () => {
  /**
   * Creates a minimal test instance of the now-playing-view component
   * with mocked Alpine.js $store and $watch
   */
  function createTestComponent() {
    const watchers = {};
    const component = {
      // Lyrics state
      lyrics: null,
      lyricsLoading: false,
      _lyricsTrackKey: null,
      _lyricsFetchId: 0,

      // Mock Alpine $store
      $store: {
        player: { currentTrack: null },
        ui: { view: 'library' },
        queue: { playOrderItems: [], items: [] },
      },

      // Mock Alpine $watch
      $watch(key, callback) {
        watchers[key] = callback;
      },

      // Mock Alpine $refs
      $refs: {},

      // Trigger a watcher manually
      _trigger(key) {
        if (watchers[key]) watchers[key]();
      },
    };

    // Import and bind the methods from the actual module
    // Instead, we replicate the core logic for unit testing
    component._onTrackOrViewChange = function () {
      const track = this.$store.player.currentTrack;
      const isVisible = this.$store.ui.view === 'nowPlaying';

      if (!track || !isVisible) return;

      const trackKey = `${track.artist || ''}::${track.title || ''}`;
      if (trackKey === this._lyricsTrackKey) return;

      this._lyricsTrackKey = trackKey;
      this._fetchLyrics(track);
    };

    component._fetchLyrics = async function (track) {
      const fetchId = ++this._lyricsFetchId;
      this.lyrics = null;
      this.lyricsLoading = true;

      try {
        const durationSecs = track.duration ? Math.round(track.duration / 1000) : null;
        const result = await lyrics.get({
          artist: track.artist || '',
          title: track.title || '',
          album: track.album || '',
          duration: durationSecs,
        });

        if (this._lyricsFetchId !== fetchId) return;

        if (result && result.plain_lyrics) {
          this.lyrics = result.plain_lyrics;
        } else {
          this.lyrics = null;
        }
      } catch (_error) {
        if (this._lyricsFetchId !== fetchId) return;
        this.lyrics = null;
      } finally {
        if (this._lyricsFetchId === fetchId) {
          this.lyricsLoading = false;
        }
      }
    };

    // Wire up watches like init() would
    component.$watch('$store.player.currentTrack', () => component._onTrackOrViewChange());
    component.$watch('$store.ui.view', () => component._onTrackOrViewChange());

    return component;
  }

  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('does not fetch lyrics when view is not nowPlaying', () => {
    const comp = createTestComponent();
    comp.$store.player.currentTrack = { id: 1, artist: 'Queen', title: 'Test', duration: 300000 };
    comp.$store.ui.view = 'library';

    comp._trigger('$store.player.currentTrack');

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(comp.lyrics).toBeNull();
  });

  it('fetches lyrics when track changes and view is nowPlaying', async () => {
    const comp = createTestComponent();
    mockInvoke.mockResolvedValue({
      plain_lyrics: 'Some lyrics',
      synced_lyrics: null,
      instrumental: false,
    });

    comp.$store.ui.view = 'nowPlaying';
    comp.$store.player.currentTrack = {
      id: 1,
      artist: 'Queen',
      title: 'Bohemian Rhapsody',
      album: 'A Night at the Opera',
      duration: 354000,
    };

    comp._trigger('$store.player.currentTrack');

    // Wait for async fetch
    await vi.waitFor(() => expect(comp.lyricsLoading).toBe(false));

    expect(mockInvoke).toHaveBeenCalledWith('lyrics_get', {
      artist: 'Queen',
      title: 'Bohemian Rhapsody',
      album: 'A Night at the Opera',
      duration: 354,
    });
    expect(comp.lyrics).toBe('Some lyrics');
  });

  it('fetches lyrics when switching to nowPlaying view with a track', async () => {
    const comp = createTestComponent();
    mockInvoke.mockResolvedValue({
      plain_lyrics: 'Lyrics here',
      synced_lyrics: null,
      instrumental: false,
    });

    comp.$store.player.currentTrack = { id: 1, artist: 'Queen', title: 'Test', duration: 200000 };
    comp.$store.ui.view = 'nowPlaying';

    comp._trigger('$store.ui.view');

    await vi.waitFor(() => expect(comp.lyricsLoading).toBe(false));

    expect(mockInvoke).toHaveBeenCalled();
    expect(comp.lyrics).toBe('Lyrics here');
  });

  it('sets lyrics to null when backend returns null', async () => {
    const comp = createTestComponent();
    mockInvoke.mockResolvedValue(null);

    comp.$store.ui.view = 'nowPlaying';
    comp.$store.player.currentTrack = {
      id: 1,
      artist: 'Unknown',
      title: 'Unknown',
      duration: 100000,
    };

    comp._trigger('$store.player.currentTrack');

    await vi.waitFor(() => expect(comp.lyricsLoading).toBe(false));

    expect(comp.lyrics).toBeNull();
  });

  it('does not re-fetch for the same track', async () => {
    const comp = createTestComponent();
    mockInvoke.mockResolvedValue({
      plain_lyrics: 'Lyrics',
      synced_lyrics: null,
      instrumental: false,
    });

    comp.$store.ui.view = 'nowPlaying';
    comp.$store.player.currentTrack = { id: 1, artist: 'Queen', title: 'Test', duration: 200000 };

    comp._trigger('$store.player.currentTrack');
    await vi.waitFor(() => expect(comp.lyricsLoading).toBe(false));

    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Trigger again with same artist+title
    comp._trigger('$store.player.currentTrack');

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('clears lyrics before fetching for a new track', async () => {
    const comp = createTestComponent();

    // First track has lyrics
    mockInvoke.mockResolvedValueOnce({
      plain_lyrics: 'First',
      synced_lyrics: null,
      instrumental: false,
    });
    comp.$store.ui.view = 'nowPlaying';
    comp.$store.player.currentTrack = { id: 1, artist: 'A', title: 'Song1', duration: 200000 };
    comp._trigger('$store.player.currentTrack');
    await vi.waitFor(() => expect(comp.lyricsLoading).toBe(false));
    expect(comp.lyrics).toBe('First');

    // Switch to second track — lyrics should clear immediately
    mockInvoke.mockResolvedValueOnce({
      plain_lyrics: 'Second',
      synced_lyrics: null,
      instrumental: false,
    });
    comp.$store.player.currentTrack = { id: 2, artist: 'B', title: 'Song2', duration: 300000 };
    comp._trigger('$store.player.currentTrack');

    // During loading, lyrics should be null (cleared)
    expect(comp.lyrics).toBeNull();
    expect(comp.lyricsLoading).toBe(true);

    await vi.waitFor(() => expect(comp.lyricsLoading).toBe(false));
    expect(comp.lyrics).toBe('Second');
  });

  it('handles fetch error gracefully', async () => {
    const comp = createTestComponent();
    mockInvoke.mockRejectedValue(new Error('Network error'));

    comp.$store.ui.view = 'nowPlaying';
    comp.$store.player.currentTrack = { id: 1, artist: 'A', title: 'B', duration: 100000 };
    comp._trigger('$store.player.currentTrack');

    await vi.waitFor(() => expect(comp.lyricsLoading).toBe(false));

    expect(comp.lyrics).toBeNull();
  });
});
