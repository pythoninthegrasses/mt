/**
 * Property-based tests for playlist event propagation using fast-check
 *
 * These tests verify that playlist mutations dispatch events to synchronize
 * components (e.g., sidebar and library context menu).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { test, fc } from '@fast-check/vitest';

// Mock API - must be defined before vi.mock due to hoisting
vi.mock('../js/api.js', () => ({
  api: {
    playlists: {
      getAll: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((name) =>
        Promise.resolve({ playlistId: Date.now(), name, position: 0 })
      ),
      rename: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      addTracks: vi.fn().mockResolvedValue({}),
      reorderPlaylists: vi.fn().mockResolvedValue({}),
    },
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue({}),
    },
  },
}));

// Import after mocks
import { createSidebar } from '../js/components/sidebar.js';
import { api } from '../js/api.js';

// Arbitraries for generating test data
const playlistNameArbitrary = fc.string({ minLength: 1, maxLength: 100 }).filter(
  (s) => s.trim().length > 0 && !s.includes('\n') && !s.includes('\r')
);

const playlistArbitrary = fc.record({
  playlistId: fc.integer({ min: 1, max: 10000 }),
  name: playlistNameArbitrary,
  position: fc.integer({ min: 0, max: 100 }),
});

const playlistListArbitrary = fc.uniqueArray(playlistArbitrary, {
  minLength: 1,
  maxLength: 20,
  selector: (p) => p.playlistId,
});

describe('Playlist Event Propagation - Property-Based Tests', () => {
  let sidebar;
  let Alpine;
  let eventsFired;
  let originalDispatchEvent;
  let mockUiStore;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    eventsFired = [];

    // Store original dispatchEvent
    originalDispatchEvent = window.dispatchEvent;

    // Mock dispatchEvent to track events
    window.dispatchEvent = vi.fn((event) => {
      eventsFired.push(event.type);
      return originalDispatchEvent.call(window, event);
    });

    // Create mock UI store
    mockUiStore = {
      toast: vi.fn(),
      setView: vi.fn(),
    };

    // Mock Alpine with stores
    Alpine = {
      data: vi.fn((name, factory) => {
        if (name === 'sidebar') {
          sidebar = factory();
          // Inject the $store reference that the component expects
          sidebar.$store = {
            ui: mockUiStore,
            library: {
              setSection: vi.fn(),
              searchQuery: '',
            },
          };
        }
      }),
    };

    // Create sidebar component
    createSidebar(Alpine);

    // Mock loadPlaylists to avoid API calls
    sidebar.loadPlaylists = vi.fn().mockResolvedValue([]);
    sidebar.loadPlaylist = vi.fn();
  });

  afterEach(() => {
    // Restore original dispatchEvent
    window.dispatchEvent = originalDispatchEvent;
  });

  describe('Rename Event Propagation', () => {
    test.prop([playlistArbitrary, playlistNameArbitrary])(
      'commitInlineRename dispatches mt:playlists-updated event on successful rename',
      async (playlist, newName) => {
        // Skip if new name is same as old name
        fc.pre(newName.trim() !== playlist.name);

        // Setup: editing an existing playlist
        sidebar.editingPlaylist = { ...playlist };
        sidebar.editingName = newName;
        sidebar.editingIsNew = false;
        sidebar.playlists = [playlist];

        // Reset event tracking
        eventsFired = [];

        // Act: commit the rename
        await sidebar.commitInlineRename();

        // Assert: API was called
        expect(api.playlists.rename).toHaveBeenCalledWith(
          playlist.playlistId,
          newName.trim()
        );

        // Assert: event was dispatched
        expect(eventsFired).toContain('mt:playlists-updated');
      }
    );

    test.prop([playlistArbitrary])(
      'commitInlineRename does NOT dispatch event when name unchanged',
      async (playlist) => {
        // Skip if trimmed name differs from original (whitespace edge case)
        // The code trims the new name before comparing, so "test " becomes "test"
        fc.pre(playlist.name.trim() === playlist.name);

        // Setup: editing but name is unchanged
        sidebar.editingPlaylist = { ...playlist };
        sidebar.editingName = playlist.name; // Same name
        sidebar.editingIsNew = false;

        // Reset event tracking
        eventsFired = [];

        // Act
        await sidebar.commitInlineRename();

        // Assert: API was NOT called
        expect(api.playlists.rename).not.toHaveBeenCalled();

        // Assert: event was NOT dispatched
        expect(eventsFired).not.toContain('mt:playlists-updated');
      }
    );

    test.prop([playlistArbitrary, fc.string({ minLength: 0, maxLength: 10 })])(
      'commitInlineRename does NOT dispatch event when name is empty/whitespace',
      async (playlist, whitespace) => {
        // Generate empty or whitespace-only name
        const emptyName = whitespace.replace(/\S/g, ' ');

        // Setup
        sidebar.editingPlaylist = { ...playlist };
        sidebar.editingName = emptyName;
        sidebar.editingIsNew = false;

        // Reset event tracking
        eventsFired = [];

        // Act
        await sidebar.commitInlineRename();

        // Assert: API was NOT called
        expect(api.playlists.rename).not.toHaveBeenCalled();

        // Assert: event was NOT dispatched
        expect(eventsFired).not.toContain('mt:playlists-updated');
      }
    );

    test.prop([playlistArbitrary, playlistNameArbitrary])(
      'commitInlineRename does NOT dispatch event on API error',
      async (playlist, newName) => {
        fc.pre(newName.trim() !== playlist.name);

        // Setup: API will fail
        api.playlists.rename.mockRejectedValueOnce(new Error('Network error'));

        sidebar.editingPlaylist = { ...playlist };
        sidebar.editingName = newName;
        sidebar.editingIsNew = false;

        // Reset event tracking
        eventsFired = [];

        // Act
        await sidebar.commitInlineRename();

        // Assert: event was NOT dispatched (rename failed)
        expect(eventsFired).not.toContain('mt:playlists-updated');
      }
    );
  });

  describe('Event Listener Synchronization', () => {
    test.prop([playlistListArbitrary, playlistNameArbitrary])(
      'listeners are notified when rename event is dispatched',
      async (playlists, newName) => {
        const playlist = playlists[0];
        fc.pre(newName.trim() !== playlist.name);

        // Setup listener tracking
        let listenerCalled = false;
        const testListener = () => {
          listenerCalled = true;
        };
        window.addEventListener('mt:playlists-updated', testListener);

        // Setup sidebar
        sidebar.editingPlaylist = { ...playlist };
        sidebar.editingName = newName;
        sidebar.editingIsNew = false;

        // Act
        await sidebar.commitInlineRename();

        // Assert: listener was called
        expect(listenerCalled).toBe(true);

        // Cleanup
        window.removeEventListener('mt:playlists-updated', testListener);
      }
    );

    test.prop([playlistListArbitrary, playlistNameArbitrary])(
      'multiple listeners all receive the rename event',
      async (playlists, newName) => {
        const playlist = playlists[0];
        fc.pre(newName.trim() !== playlist.name);

        // Setup multiple listeners
        const listenerCalls = [];
        const listener1 = () => listenerCalls.push('listener1');
        const listener2 = () => listenerCalls.push('listener2');
        const listener3 = () => listenerCalls.push('listener3');

        window.addEventListener('mt:playlists-updated', listener1);
        window.addEventListener('mt:playlists-updated', listener2);
        window.addEventListener('mt:playlists-updated', listener3);

        // Setup sidebar
        sidebar.editingPlaylist = { ...playlist };
        sidebar.editingName = newName;
        sidebar.editingIsNew = false;

        // Act
        await sidebar.commitInlineRename();

        // Assert: all listeners were called
        expect(listenerCalls).toContain('listener1');
        expect(listenerCalls).toContain('listener2');
        expect(listenerCalls).toContain('listener3');

        // Cleanup
        window.removeEventListener('mt:playlists-updated', listener1);
        window.removeEventListener('mt:playlists-updated', listener2);
        window.removeEventListener('mt:playlists-updated', listener3);
      }
    );
  });

  describe('New Playlist Creation Event Propagation', () => {
    test.prop([playlistNameArbitrary])(
      'committing a new playlist rename dispatches event',
      async (name) => {
        // Setup: creating a new playlist (editingIsNew = true)
        const newPlaylist = { playlistId: 999, name: 'New playlist', position: 0 };
        sidebar.editingPlaylist = newPlaylist;
        sidebar.editingName = name;
        sidebar.editingIsNew = true;

        // Reset event tracking
        eventsFired = [];

        // Act
        await sidebar.commitInlineRename();

        // Assert: API was called with new name
        expect(api.playlists.rename).toHaveBeenCalledWith(999, name.trim());

        // Assert: event was dispatched
        expect(eventsFired).toContain('mt:playlists-updated');
      }
    );
  });

  describe('Edge Cases', () => {
    it('handles null editingPlaylist gracefully', async () => {
      sidebar.editingPlaylist = null;
      sidebar.editingName = 'test';

      // Should not throw
      await expect(sidebar.commitInlineRename()).resolves.not.toThrow();

      // API should not be called
      expect(api.playlists.rename).not.toHaveBeenCalled();
    });

    test.prop([playlistArbitrary])(
      'handles UNIQUE constraint error without dispatching event',
      async (playlist) => {
        // Setup: API will fail with duplicate name error
        api.playlists.rename.mockRejectedValueOnce(
          new Error('UNIQUE constraint failed')
        );

        sidebar.editingPlaylist = { ...playlist };
        sidebar.editingName = 'Duplicate Name';
        sidebar.editingIsNew = false;

        // Reset event tracking
        eventsFired = [];

        // Act
        await sidebar.commitInlineRename();

        // Assert: toast was shown
        expect(mockUiStore.toast).toHaveBeenCalledWith(
          'A playlist with that name already exists',
          'error'
        );

        // Assert: event was NOT dispatched
        expect(eventsFired).not.toContain('mt:playlists-updated');
      }
    );

    test.prop([
      fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
    ])('handles very long playlist names', async (longName) => {
      const playlist = { playlistId: 1, name: 'Short', position: 0 };

      sidebar.editingPlaylist = playlist;
      sidebar.editingName = longName;
      sidebar.editingIsNew = false;

      // Reset event tracking
      eventsFired = [];

      // Act
      await sidebar.commitInlineRename();

      // Assert: API was called with trimmed name
      expect(api.playlists.rename).toHaveBeenCalledWith(1, longName.trim());

      // Assert: event was dispatched
      expect(eventsFired).toContain('mt:playlists-updated');
    });
  });
});
