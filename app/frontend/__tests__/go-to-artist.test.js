/**
 * Tests for "Go to Artist" context menu item and cross-view navigation
 *
 * Covers:
 * - context-menu-actions mixin: goToArtist dispatches mt:navigate-to-artist event
 * - artists-browser: mt:navigate-to-artist handler finds artist, sets view, selects artist
 * - artists-browser: toast shown when artist not found
 * - Menu item disabled when multiple tracks selected or no artist metadata
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock IntersectionObserver for jsdom
globalThis.IntersectionObserver = class {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock('../js/api/favorites.js', () => ({
  favorites: {
    check: vi.fn().mockResolvedValue({ is_favorite: false }),
    add: vi.fn().mockResolvedValue({ success: true }),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../js/api/playlists.js', () => ({
  playlists: {
    getAll: vi.fn().mockResolvedValue([]),
    addTracks: vi.fn().mockResolvedValue({ added: 1 }),
  },
}));

vi.mock('../js/api/library.js', () => ({
  library: {
    getArtworkUrl: vi.fn().mockResolvedValue(null),
  },
}));

function createAlpineMock() {
  const stores = {};
  const storeFn = function (name, value) {
    if (value !== undefined) {
      stores[name] = value;
    }
    return stores[name];
  };
  return {
    store: storeFn,
    data(name, factory) {
      this._lastData = { name, factory };
    },
    _stores: stores,
    createStoreProxy() {
      const proxy = new Proxy(storeFn, {
        get(target, prop) {
          if (typeof prop === 'string' && prop !== 'bind' && prop !== 'call' && prop !== 'apply') {
            return stores[prop];
          }
          return Reflect.get(target, prop);
        },
        apply(target, thisArg, args) {
          return target(...args);
        },
      });
      return proxy;
    },
  };
}

function createMockTrack(id = 1, overrides = {}) {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Test Artist',
    album: 'Test Album',
    album_artist: 'Test Artist',
    duration: 180000,
    file_path: `/music/track${id}.mp3`,
    ...overrides,
  };
}

function createMockEvent(x = 100, y = 100) {
  return {
    preventDefault: vi.fn(),
    clientX: x,
    clientY: y,
  };
}

describe('Go to Artist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('context-menu-actions mixin (goToArtist)', () => {
    let component;

    beforeEach(async () => {
      const Alpine = createAlpineMock();
      Alpine.store('ui', {
        toast: vi.fn(),
        view: 'tracks',
      });
      Alpine.store('library', {
        filteredTracks: [createMockTrack(1), createMockTrack(2)],
        refreshIfLikedSongs: vi.fn(),
      });
      Alpine.store('queue', {
        items: [],
        currentIndex: -1,
      });
      Alpine.store('player', {
        currentTrack: null,
        isFavorite: false,
      });

      const { createLibraryBrowser } = await import(
        '../js/components/library-browser.js'
      );
      createLibraryBrowser(Alpine);
      const factory = Alpine._lastData.factory;
      component = factory();
      component.$store = Alpine.createStoreProxy();
    });

    it('dispatches mt:navigate-to-artist event with artist name', () => {
      const track = createMockTrack(1, {
        artist: 'My Artist',
        album_artist: 'My Album Artist',
      });

      const listener = vi.fn();
      window.addEventListener('mt:navigate-to-artist', listener);

      component.goToArtist(track);

      expect(listener).toHaveBeenCalledTimes(1);
      const detail = listener.mock.calls[0][0].detail;
      expect(detail.artist).toBe('My Album Artist');

      window.removeEventListener('mt:navigate-to-artist', listener);
    });

    it('uses track.artist as fallback when album_artist is missing', () => {
      const track = createMockTrack(1, {
        album_artist: undefined,
        artist: 'Fallback Artist',
      });

      const listener = vi.fn();
      window.addEventListener('mt:navigate-to-artist', listener);

      component.goToArtist(track);

      const detail = listener.mock.calls[0][0].detail;
      expect(detail.artist).toBe('Fallback Artist');

      window.removeEventListener('mt:navigate-to-artist', listener);
    });

    it('does not dispatch event when track has no artist metadata', () => {
      const track = createMockTrack(1, { artist: '', album_artist: '' });

      const listener = vi.fn();
      window.addEventListener('mt:navigate-to-artist', listener);

      component.goToArtist(track);

      expect(listener).not.toHaveBeenCalled();

      window.removeEventListener('mt:navigate-to-artist', listener);
    });

    it('closes context menu when goToArtist is called', () => {
      const track = createMockTrack(1);
      component.contextMenu = { x: 0, y: 0, items: [] };

      component.goToArtist(track);

      expect(component.contextMenu).toBeNull();
    });

    it('context menu shows Go to Artist item before Go to Album', () => {
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.handleContextMenu(event, track, 0);

      const items = component.contextMenu.items;
      const goToArtistIndex = items.findIndex((i) => i.label === 'Go to Artist');
      const goToAlbumIndex = items.findIndex((i) => i.label === 'Go to Album');

      expect(goToArtistIndex).toBeGreaterThan(-1);
      expect(goToAlbumIndex).toBeGreaterThan(-1);
      expect(goToArtistIndex).toBeLessThan(goToAlbumIndex);
    });

    it('Go to Artist is disabled when multiple tracks selected', () => {
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.selectedTracks = new Set([1, 2]);
      component.handleContextMenu(event, track, 0);

      const item = component.contextMenu.items.find(
        (i) => i.label === 'Go to Artist',
      );
      expect(item.disabled).toBe(true);
    });

    it('Go to Artist is disabled when track has no artist metadata', () => {
      const track = createMockTrack(1, { artist: '', album_artist: '' });
      const event = createMockEvent();

      component.handleContextMenu(event, track, 0);

      const item = component.contextMenu.items.find(
        (i) => i.label === 'Go to Artist',
      );
      expect(item.disabled).toBe(true);
    });
  });

  describe('artists-browser (mt:navigate-to-artist handler)', () => {
    let component;
    let Alpine;
    let watchCallbacks;

    beforeEach(async () => {
      Alpine = createAlpineMock();
      Alpine.store('ui', {
        toast: vi.fn(),
        view: 'artists',
        setView: vi.fn((v) => {
          Alpine._stores.ui.view = v;
          for (const cb of watchCallbacks) {
            cb(v);
          }
        }),
        sortIgnoreWords: false,
        sortIgnoreWordsList: '',
      });
      Alpine.store('library', {
        allTracks: [
          createMockTrack(1, { album: 'Album 1', album_artist: 'Found Artist' }),
          createMockTrack(2, { album: 'Album 2', album_artist: 'Other Artist' }),
        ],
        _dataVersion: 1,
        refreshIfLikedSongs: vi.fn(),
      });
      Alpine.store('queue', {
        items: [],
        currentIndex: -1,
        clear: vi.fn(),
        addTracks: vi.fn(),
        playNextTracks: vi.fn(),
      });
      Alpine.store('player', {
        currentTrack: null,
        isFavorite: false,
      });

      watchCallbacks = [];

      const { createArtistsBrowser } = await import(
        '../js/components/artists-browser.js'
      );
      createArtistsBrowser(Alpine);
      const factory = Alpine._lastData.factory;
      component = factory();
      component.$store = Alpine.createStoreProxy();
      component.$watch = (_expr, cb) => {
        watchCallbacks.push(cb);
      };
      component.$nextTick = (fn) => fn();
      component._loadPlaylists = vi.fn();

      component.init();
    });

    afterEach(() => {
      if (component.destroy) {
        component.destroy();
      }
    });

    it('selects artist and switches view when artist is found', () => {
      window.dispatchEvent(
        new CustomEvent('mt:navigate-to-artist', {
          detail: { artist: 'Found Artist' },
        }),
      );

      expect(Alpine._stores.ui.setView).toHaveBeenCalledWith('artists');
      expect(component.selectedArtist).toBe('Found Artist');
    });

    it('shows error toast when artist is not found', () => {
      window.dispatchEvent(
        new CustomEvent('mt:navigate-to-artist', {
          detail: { artist: 'Nonexistent Artist' },
        }),
      );

      expect(Alpine._stores.ui.toast).toHaveBeenCalledWith(
        'Artist not found: "Nonexistent Artist"',
        'error',
      );
    });

    it('performs case-insensitive artist matching', () => {
      window.dispatchEvent(
        new CustomEvent('mt:navigate-to-artist', {
          detail: { artist: 'FOUND ARTIST' },
        }),
      );

      expect(component.selectedArtist).toBe('Found Artist');
    });

    it('scrolls detail panel to top when navigating to artist', () => {
      const mockDetailPanel = { scrollTop: 500 };
      const originalQuerySelector = document.querySelector;
      document.querySelector = vi.fn((selector) => {
        if (selector === '[data-testid="artist-detail"]') {
          return mockDetailPanel;
        }
        return originalQuerySelector.call(document, selector);
      });

      window.dispatchEvent(
        new CustomEvent('mt:navigate-to-artist', {
          detail: { artist: 'Found Artist' },
        }),
      );

      expect(mockDetailPanel.scrollTop).toBe(0);

      document.querySelector = originalQuerySelector;
    });

    it('calls _loadPlaylists on init', () => {
      expect(component._loadPlaylists).toHaveBeenCalled();
    });

    it('calls _loadPlaylists when mt:playlists-updated fires', () => {
      component._loadPlaylists.mockClear();

      window.dispatchEvent(new CustomEvent('mt:playlists-updated'));

      expect(component._loadPlaylists).toHaveBeenCalledTimes(1);
    });

    it('removes event listener on destroy', () => {
      const originalRemove = window.removeEventListener;
      window.removeEventListener = vi.fn(originalRemove.bind(window));

      component.destroy();

      expect(window.removeEventListener).toHaveBeenCalledWith(
        'mt:navigate-to-artist',
        expect.any(Function),
      );

      window.removeEventListener = originalRemove;
    });
  });
});
