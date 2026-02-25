/**
 * Tests for "Go to Album" context menu item and cross-view navigation
 *
 * Covers:
 * - context-menu-actions mixin: goToAlbum dispatches mt:navigate-to-album event
 * - albums-browser: mt:navigate-to-album handler finds album, sets view, opens detail
 * - albums-browser: toast shown when album not found
 * - albums-browser: _skipGridReset prevents view watcher from resetting to grid
 * - albums-browser: event listener cleanup in destroy()
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

describe('Go to Album', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('context-menu-actions mixin (goToAlbum)', () => {
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

    it('dispatches mt:navigate-to-album event with album and albumArtist', () => {
      const track = createMockTrack(1, {
        album: 'My Album',
        album_artist: 'My Artist',
      });

      const listener = vi.fn();
      window.addEventListener('mt:navigate-to-album', listener);

      component.goToAlbum(track);

      expect(listener).toHaveBeenCalledTimes(1);
      const detail = listener.mock.calls[0][0].detail;
      expect(detail.album).toBe('My Album');
      expect(detail.albumArtist).toBe('My Artist');

      window.removeEventListener('mt:navigate-to-album', listener);
    });

    it('uses track.artist as fallback when album_artist is missing', () => {
      const track = createMockTrack(1, {
        album: 'My Album',
        album_artist: undefined,
        artist: 'Fallback Artist',
      });

      const listener = vi.fn();
      window.addEventListener('mt:navigate-to-album', listener);

      component.goToAlbum(track);

      const detail = listener.mock.calls[0][0].detail;
      expect(detail.albumArtist).toBe('Fallback Artist');

      window.removeEventListener('mt:navigate-to-album', listener);
    });

    it('does not dispatch event when track has no album', () => {
      const track = createMockTrack(1, { album: '' });

      const listener = vi.fn();
      window.addEventListener('mt:navigate-to-album', listener);

      component.goToAlbum(track);

      expect(listener).not.toHaveBeenCalled();

      window.removeEventListener('mt:navigate-to-album', listener);
    });

    it('closes context menu when goToAlbum is called', () => {
      const track = createMockTrack(1);
      component.contextMenu = { x: 0, y: 0, items: [] };

      component.goToAlbum(track);

      expect(component.contextMenu).toBeNull();
    });

    it('context menu shows Go to Album item', () => {
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.handleContextMenu(event, track, 0);

      const item = component.contextMenu.items.find(
        (i) => i.label === 'Go to Album',
      );
      expect(item).toBeDefined();
    });

    it('Go to Album is disabled when multiple tracks selected', () => {
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.selectedTracks = new Set([1, 2]);
      component.handleContextMenu(event, track, 0);

      const item = component.contextMenu.items.find(
        (i) => i.label === 'Go to Album',
      );
      expect(item.disabled).toBe(true);
    });

    it('Go to Album is disabled when track has no album', () => {
      const track = createMockTrack(1, { album: '' });
      const event = createMockEvent();

      component.handleContextMenu(event, track, 0);

      const item = component.contextMenu.items.find(
        (i) => i.label === 'Go to Album',
      );
      expect(item.disabled).toBe(true);
    });
  });

  describe('albums-browser (mt:navigate-to-album handler)', () => {
    let component;
    let Alpine;
    let watchCallbacks;

    beforeEach(async () => {
      Alpine = createAlpineMock();
      Alpine.store('ui', {
        toast: vi.fn(),
        view: 'albums',
        setView: vi.fn((v) => {
          Alpine._stores.ui.view = v;
          // Trigger watchers
          for (const cb of watchCallbacks) {
            cb(v);
          }
        }),
      });
      Alpine.store('library', {
        allTracks: [
          createMockTrack(1, { album: 'Found Album', album_artist: 'Found Artist' }),
          createMockTrack(2, { album: 'Other Album', album_artist: 'Other Artist' }),
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

      const { createAlbumsBrowser } = await import(
        '../js/components/albums-browser.js'
      );
      createAlbumsBrowser(Alpine);
      const factory = Alpine._lastData.factory;
      component = factory();
      component.$store = Alpine.createStoreProxy();
      component.$refs = { gridContainer: { scrollTop: 0 } };
      component.$nextTick = (fn) => fn();
      component.$watch = (_expr, cb) => {
        watchCallbacks.push(cb);
      };

      component.init();
    });

    afterEach(() => {
      component.destroy();
    });

    it('navigates to album detail when album is found', () => {
      window.dispatchEvent(
        new CustomEvent('mt:navigate-to-album', {
          detail: { album: 'Found Album', albumArtist: 'Found Artist' },
        }),
      );

      expect(Alpine._stores.ui.setView).toHaveBeenCalledWith('albums');
      expect(component.subView).toBe('detail');
      expect(component.selectedAlbum.name).toBe('Found Album');
    });

    it('shows error toast when album is not found', () => {
      window.dispatchEvent(
        new CustomEvent('mt:navigate-to-album', {
          detail: { album: 'Nonexistent Album', albumArtist: 'Nobody' },
        }),
      );

      expect(Alpine._stores.ui.toast).toHaveBeenCalledWith(
        'Album not found: "Nonexistent Album"',
        'error',
      );
      expect(component.subView).toBe('grid');
    });

    it('does not reset to grid during programmatic navigation', () => {
      // Start in grid view
      component.subView = 'grid';

      window.dispatchEvent(
        new CustomEvent('mt:navigate-to-album', {
          detail: { album: 'Found Album', albumArtist: 'Found Artist' },
        }),
      );

      // Should be in detail view, not reset to grid
      expect(component.subView).toBe('detail');
      expect(component.selectedAlbum.name).toBe('Found Album');
    });

    it('resets _skipGridReset after navigation completes', () => {
      window.dispatchEvent(
        new CustomEvent('mt:navigate-to-album', {
          detail: { album: 'Found Album', albumArtist: 'Found Artist' },
        }),
      );

      // The flag should be cleared after openAlbumDetail
      expect(component._skipGridReset).toBe(false);
    });

    it('sidebar navigation resets detail view to grid', () => {
      component.subView = 'detail';
      component.selectedAlbum = { name: 'Test' };

      // Simulate sidebar click triggering view watcher
      const watcher = watchCallbacks[0];
      watcher('albums');

      expect(component.subView).toBe('grid');
    });

    it('removes event listeners on destroy', () => {
      const listenersBefore = vi.fn();
      const originalRemove = window.removeEventListener;
      window.removeEventListener = vi.fn(originalRemove.bind(window));

      component.destroy();

      expect(window.removeEventListener).toHaveBeenCalledWith(
        'mt:navigate-to-album',
        expect.any(Function),
      );
      expect(window.removeEventListener).toHaveBeenCalledWith(
        'mt:playlists-updated',
        expect.any(Function),
      );

      window.removeEventListener = originalRemove;
    });

    it('does not register duplicate listeners after destroy and re-init', () => {
      const listener = vi.fn();
      const originalAdd = window.addEventListener;

      component.destroy();

      // Re-init should work without duplicates
      window.addEventListener = vi.fn(originalAdd.bind(window));
      component.init();

      const navigateCalls = window.addEventListener.mock.calls.filter(
        (c) => c[0] === 'mt:navigate-to-album',
      );
      expect(navigateCalls).toHaveLength(1);

      window.addEventListener = originalAdd;
      component.destroy();
    });
  });
});
