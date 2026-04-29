/**
 * Tests for Now Playing context menu
 *
 * Verifies that right-clicking a track in the Now Playing / Up Next queue list
 * opens a context menu with queue-specific actions (Play Now, Play Next,
 * Remove from Queue, etc.) and that each action calls the correct store/API method.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

vi.mock('../js/api/queue.js', () => ({
  queue: {
    add: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../js/api/lyrics.js', () => ({
  lyrics: {
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../js/api/shared.js', () => ({
  tauriInvoke: vi.fn(),
  tauriConfirm: vi.fn(),
}));

import { favorites } from '../js/api/favorites.js';
import { tauriInvoke } from '../js/api/shared.js';

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

function createMockTrack(id = 1) {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Artist',
    album: 'Album',
    duration: 180000,
    filepath: `/music/track${id}.mp3`,
  };
}

function createMockEvent(x = 100, y = 100) {
  return {
    preventDefault: vi.fn(),
    clientX: x,
    clientY: y,
  };
}

describe('Now Playing Context Menu', () => {
  let component;
  let queueStore;

  beforeEach(async () => {
    vi.clearAllMocks();

    const Alpine = createAlpineMock();

    queueStore = {
      items: [createMockTrack(1), createMockTrack(2), createMockTrack(3)],
      currentIndex: 0,
      playIndex: vi.fn(),
      playNextTracks: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn(),
      _loadFromBackend: vi.fn().mockResolvedValue(undefined),
    };

    Alpine.store('queue', queueStore);
    Alpine.store('ui', {
      toast: vi.fn(),
      view: 'nowPlaying',
    });
    Alpine.store('library', {
      refreshIfLikedSongs: vi.fn(),
    });
    Alpine.store('player', {
      currentTrack: createMockTrack(1),
      isFavorite: false,
    });

    const { createNowPlayingView } = await import(
      '../js/components/now-playing-view.js'
    );
    createNowPlayingView(Alpine);
    const factory = Alpine._lastData.factory;
    component = factory();
    component.$store = Alpine.createStoreProxy();
    component.$watch = vi.fn();
    component.$refs = { queueList: null };
    component.$el = { querySelector: vi.fn() };
    component.$nextTick = vi.fn((cb) => cb?.());
  });

  describe('handleContextMenu', () => {
    it('opens context menu on right-click with correct items', () => {
      const track = createMockTrack(2);
      const event = createMockEvent();

      component.handleContextMenu(event, track, 1);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.contextMenu).not.toBeNull();
      expect(component.contextMenu.track).toBe(track);

      const labels = component.contextMenu.items
        .filter((i) => i.type !== 'separator')
        .map((i) => i.label);
      expect(labels).toEqual([
        'Play Now',
        'Play Next',
        'Add to Playlist',
        'Add to Liked Songs',
        'Show in Finder',
        'Remove from Queue',
      ]);
    });

    it('includes separators between action groups', () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

      const types = component.contextMenu.items.map((i) => i.type || 'action');
      expect(types).toEqual([
        'action', // Play Now
        'action', // Play Next
        'separator',
        'action', // Add to Playlist
        'action', // Add to Liked Songs
        'separator',
        'action', // Show in Finder
        'separator',
        'action', // Remove from Queue
      ]);
    });

    it('disables Play Next and Remove for the currently playing track', () => {
      const track = createMockTrack(1);
      component.handleContextMenu(createMockEvent(), track, 0); // index 0 = currentIndex

      const playNext = component.contextMenu.items.find((i) => i.label === 'Play Next');
      const remove = component.contextMenu.items.find((i) => i.label === 'Remove from Queue');

      expect(playNext.disabled).toBe(true);
      expect(remove.disabled).toBe(true);
    });

    it('enables Play Next and Remove for non-current tracks', () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

      const playNext = component.contextMenu.items.find((i) => i.label === 'Play Next');
      const remove = component.contextMenu.items.find((i) => i.label === 'Remove from Queue');

      expect(playNext.disabled).toBeFalsy();
      expect(remove.disabled).toBeFalsy();
    });

    it('marks Remove from Queue as a danger item', () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

      const remove = component.contextMenu.items.find((i) => i.label === 'Remove from Queue');
      expect(remove.danger).toBe(true);
    });

    it('marks Add to Playlist as having a submenu', () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

      const addToPlaylist = component.contextMenu.items.find(
        (i) => i.label === 'Add to Playlist',
      );
      expect(addToPlaylist.hasSubmenu).toBe(true);
    });
  });

  describe('menu positioning', () => {
    it('positions menu at cursor coordinates', () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(200, 300), track, 1);

      expect(component.contextMenu.x).toBe(200);
      expect(component.contextMenu.y).toBe(300);
    });

    it('flips menu left when it would overflow right edge', () => {
      const track = createMockTrack(2);
      // Position near right edge of viewport (default innerWidth = 1024)
      component.handleContextMenu(createMockEvent(900, 100), track, 1);

      expect(component.contextMenu.x).toBeLessThan(900);
    });

    it('shifts menu up when it would overflow bottom edge', () => {
      const track = createMockTrack(2);
      // Position near bottom of viewport (default innerHeight = 768)
      component.handleContextMenu(createMockEvent(100, 600), track, 1);

      expect(component.contextMenu.y).toBeLessThan(600);
    });

    it('sets submenuOnLeft when menu is near right edge', () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(700, 100), track, 1);

      expect(component.submenuOnLeft).toBe(true);
    });
  });

  describe('Play Now action', () => {
    it('calls queue.playIndex with the correct index', () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

      const playNow = component.contextMenu.items.find((i) => i.label === 'Play Now');
      playNow.action();

      expect(queueStore.playIndex).toHaveBeenCalledWith(1);
    });

    it('closes the context menu after action', () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

      const playNow = component.contextMenu.items.find((i) => i.label === 'Play Now');
      playNow.action();

      expect(component.contextMenu).toBeNull();
    });
  });

  describe('Play Next action', () => {
    it('calls queue.playNextTracks with the track', async () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

      const playNext = component.contextMenu.items.find((i) => i.label === 'Play Next');
      await playNext.action();

      expect(queueStore.playNextTracks).toHaveBeenCalledWith([track]);
    });

    it('shows a toast after moving track to play next', async () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

      const playNext = component.contextMenu.items.find((i) => i.label === 'Play Next');
      await playNext.action();

      expect(component.$store.ui.toast).toHaveBeenCalledWith('Playing next', 'success');
    });
  });

  describe('Remove from Queue action', () => {
    it('calls queue.remove with the correct index', () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

      const remove = component.contextMenu.items.find((i) => i.label === 'Remove from Queue');
      remove.action();

      expect(queueStore.remove).toHaveBeenCalledWith(1);
    });

    it('closes the context menu after removal', () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

      const remove = component.contextMenu.items.find((i) => i.label === 'Remove from Queue');
      remove.action();

      expect(component.contextMenu).toBeNull();
    });
  });

  describe('Liked Songs toggle', () => {
    it('shows "Add to Liked Songs" for an unliked track', async () => {
      favorites.check.mockResolvedValue({ is_favorite: false });
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Add to Liked Songs',
        );
        expect(item).toBeDefined();
      });
    });

    it('shows "Remove from Liked Songs" for a liked track', async () => {
      favorites.check.mockResolvedValue({ is_favorite: true });
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

      await vi.waitFor(() => {
        const item = component.contextMenu.items.find(
          (i) => i.label === 'Remove from Liked Songs',
        );
        expect(item).toBeDefined();
      });
    });

    it('calls favorites.add when toggling an unliked track', async () => {
      favorites.check.mockResolvedValue({ is_favorite: false });
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

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

      expect(favorites.add).toHaveBeenCalledWith(2);
    });

    it('calls favorites.remove when toggling a liked track', async () => {
      favorites.check.mockResolvedValue({ is_favorite: true });
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

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

      expect(favorites.remove).toHaveBeenCalledWith(2);
    });
  });

  describe('closeContextMenu', () => {
    it('sets contextMenu to null', () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);
      expect(component.contextMenu).not.toBeNull();

      component.closeContextMenu();

      expect(component.contextMenu).toBeNull();
    });

    it('hides playlist submenu', () => {
      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);
      component.showPlaylistSubmenu = true;

      component.closeContextMenu();

      expect(component.showPlaylistSubmenu).toBe(false);
    });
  });

  describe('Show in Finder action', () => {
    it('calls Tauri invoke with the track filepath', async () => {
      vi.mocked(tauriInvoke).mockResolvedValueOnce(undefined);

      const track = createMockTrack(2);
      component.handleContextMenu(createMockEvent(), track, 1);

      const showInFinder = component.contextMenu.items.find(
        (i) => i.label === 'Show in Finder',
      );
      await showInFinder.action();

      expect(tauriInvoke).toHaveBeenCalledWith('show_in_folder', {
        path: '/music/track2.mp3',
      });
    });
  });
});
