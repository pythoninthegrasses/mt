/**
 * Tests for "Add to Liked Songs" / "Remove from Liked Songs" context menu item
 *
 * Verifies that the context menu in library-browser, artists-browser, and
 * albums-browser includes a toggle-favorite item that checks the track's
 * favorite status and calls the correct API.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/api.js', () => ({
  api: {
    favorites: {
      check: vi.fn(),
      add: vi.fn().mockResolvedValue({ success: true }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    playlists: {
      getAll: vi.fn().mockResolvedValue([]),
      addTracks: vi.fn().mockResolvedValue({ added: 1 }),
    },
    queue: {
      add: vi.fn().mockResolvedValue({}),
    },
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { api } from '../js/api.js';

// Minimal Alpine mock
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
    // Create a $store proxy that works both as obj.ui and as fn('ui')
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

function createMockTrack(id = 1) {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 180000,
    file_path: `/music/track${id}.mp3`,
  };
}

function createMockEvent(x = 100, y = 100) {
  return {
    preventDefault: vi.fn(),
    clientX: x,
    clientY: y,
  };
}

describe('Context Menu - Liked Songs Toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('library-browser', () => {
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
        currentTrack: createMockTrack(1),
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

    it('shows "Add to Liked Songs" for an unliked track', async () => {
      api.favorites.check.mockResolvedValue({ is_favorite: false });
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.handleContextMenu(event, track, 0);
      // Wait for async favorite check
      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Add to Liked Songs',
        );
        expect(item).toBeDefined();
      });

      expect(api.favorites.check).toHaveBeenCalledWith(1);
    });

    it('shows "Remove from Liked Songs" for a liked track', async () => {
      api.favorites.check.mockResolvedValue({ is_favorite: true });
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.handleContextMenu(event, track, 0);
      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Remove from Liked Songs',
        );
        expect(item).toBeDefined();
      });
    });

    it('calls api.favorites.add when toggling an unliked track', async () => {
      api.favorites.check.mockResolvedValue({ is_favorite: false });
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.handleContextMenu(event, track, 0);
      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Add to Liked Songs',
        );
        expect(item).toBeDefined();
      });

      const item = component.contextMenu.items.find(
        (i) => i.label === 'Add to Liked Songs',
      );
      await item.action();

      expect(api.favorites.add).toHaveBeenCalledWith(1);
    });

    it('calls api.favorites.remove when toggling a liked track', async () => {
      api.favorites.check.mockResolvedValue({ is_favorite: true });
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.handleContextMenu(event, track, 0);
      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Remove from Liked Songs',
        );
        expect(item).toBeDefined();
      });

      const item = component.contextMenu.items.find(
        (i) => i.label === 'Remove from Liked Songs',
      );
      await item.action();

      expect(api.favorites.remove).toHaveBeenCalledWith(1);
    });

    it('refreshes library liked songs view after toggling', async () => {
      api.favorites.check.mockResolvedValue({ is_favorite: false });
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.handleContextMenu(event, track, 0);
      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Add to Liked Songs',
        );
        expect(item).toBeDefined();
      });

      const item = component.contextMenu.items.find(
        (i) => i.label === 'Add to Liked Songs',
      );
      await item.action();

      expect(
        component.$store.library.refreshIfLikedSongs,
      ).toHaveBeenCalled();
    });

    it('updates player.isFavorite when toggling the currently playing track', async () => {
      api.favorites.check.mockResolvedValue({ is_favorite: false });
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.handleContextMenu(event, track, 0);
      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Add to Liked Songs',
        );
        expect(item).toBeDefined();
      });

      const item = component.contextMenu.items.find(
        (i) => i.label === 'Add to Liked Songs',
      );
      await item.action();

      expect(component.$store.player.isFavorite).toBe(true);
    });

    it('does not update player.isFavorite when toggling a different track', async () => {
      api.favorites.check.mockResolvedValue({ is_favorite: false });
      const track = createMockTrack(2);
      const event = createMockEvent();

      component.handleContextMenu(event, track, 1);
      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Add to Liked Songs',
        );
        expect(item).toBeDefined();
      });

      const item = component.contextMenu.items.find(
        (i) => i.label === 'Add to Liked Songs',
      );
      await item.action();

      expect(component.$store.player.isFavorite).toBe(false);
    });
  });

  describe('artists-browser', () => {
    let component;

    beforeEach(async () => {
      const Alpine = createAlpineMock();
      Alpine.store('ui', {
        toast: vi.fn(),
        view: 'artists',
      });
      Alpine.store('library', {
        tracks: [createMockTrack(1)],
        refreshIfLikedSongs: vi.fn(),
      });
      Alpine.store('queue', {
        items: [],
        currentIndex: -1,
        add: vi.fn(),
      });

      const { createArtistsBrowser } = await import(
        '../js/components/artists-browser.js'
      );
      createArtistsBrowser(Alpine);
      const factory = Alpine._lastData.factory;
      component = factory();
      component.$store = Alpine.createStoreProxy();
      component.$watch = vi.fn();
    });

    it('shows "Add to Liked Songs" for an unliked track', async () => {
      api.favorites.check.mockResolvedValue({ is_favorite: false });
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.handleContextMenu(event, track);
      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Add to Liked Songs',
        );
        expect(item).toBeDefined();
      });

      expect(api.favorites.check).toHaveBeenCalledWith(1);
    });

    it('shows "Remove from Liked Songs" for a liked track', async () => {
      api.favorites.check.mockResolvedValue({ is_favorite: true });
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.handleContextMenu(event, track);
      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Remove from Liked Songs',
        );
        expect(item).toBeDefined();
      });
    });

    it('calls correct API when toggling favorite', async () => {
      api.favorites.check.mockResolvedValue({ is_favorite: false });
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.handleContextMenu(event, track);
      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Add to Liked Songs',
        );
        expect(item).toBeDefined();
      });

      const item = component.contextMenu.items.find(
        (i) => i.label === 'Add to Liked Songs',
      );
      await item.action();

      expect(api.favorites.add).toHaveBeenCalledWith(1);
    });
  });

  describe('albums-browser', () => {
    let component;

    beforeEach(async () => {
      const Alpine = createAlpineMock();
      Alpine.store('ui', {
        toast: vi.fn(),
        view: 'albums',
      });
      Alpine.store('library', {
        tracks: [createMockTrack(1)],
        refreshIfLikedSongs: vi.fn(),
      });
      Alpine.store('queue', {
        items: [],
        currentIndex: -1,
        addTracks: vi.fn(),
        playNextTracks: vi.fn(),
      });

      const { createAlbumsBrowser } = await import(
        '../js/components/albums-browser.js'
      );
      createAlbumsBrowser(Alpine);
      const factory = Alpine._lastData.factory;
      component = factory();
      component.$store = Alpine.createStoreProxy();
      component.$watch = vi.fn();
    });

    it('shows "Add to Liked Songs" for an unliked track', async () => {
      api.favorites.check.mockResolvedValue({ is_favorite: false });
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.showTrackContextMenu(event, track, 0);
      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Add to Liked Songs',
        );
        expect(item).toBeDefined();
      });

      expect(api.favorites.check).toHaveBeenCalledWith(1);
    });

    it('shows "Remove from Liked Songs" for a liked track', async () => {
      api.favorites.check.mockResolvedValue({ is_favorite: true });
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.showTrackContextMenu(event, track, 0);
      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Remove from Liked Songs',
        );
        expect(item).toBeDefined();
      });
    });

    it('calls correct API when toggling favorite', async () => {
      api.favorites.check.mockResolvedValue({ is_favorite: false });
      const track = createMockTrack(1);
      const event = createMockEvent();

      component.showTrackContextMenu(event, track, 0);
      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Add to Liked Songs',
        );
        expect(item).toBeDefined();
      });

      const item = component.contextMenu.items.find(
        (i) => i.label === 'Add to Liked Songs',
      );
      await item.action();

      expect(api.favorites.add).toHaveBeenCalledWith(1);
    });
  });
});
