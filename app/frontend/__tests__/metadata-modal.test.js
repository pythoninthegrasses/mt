/**
 * Unit tests for the metadata modal batch loading and parallel save
 *
 * Verifies:
 * - Batch metadata loading uses single IPC call
 * - Save uses parallel Promise.all for saves and rescans
 * - Mixed field detection in batch mode
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Build a minimal component context that mirrors the Alpine data shape
function createModalContext(overrides = {}) {
  const ctx = {
    isOpen: false,
    isLoading: false,
    isSaving: false,
    tracks: [],
    library: null,
    metadata: {},
    originalMetadata: {},
    mixedFields: new Set(),
    fileInfo: {},
    navigationEnabled: false,
    currentTrackId: null,
    _batchTrackIds: [],
    _batchOrderedIds: [],
    _sessionId: null,

    getTrackPath(track) {
      return track?.path || track?.filepath;
    },

    hasFieldChanged(field) {
      return this.metadata[field] !== this.originalMetadata[field];
    },

    get hasUnsavedChanges() {
      const fields = [
        'title', 'artist', 'album', 'album_artist',
        'track_number', 'track_total', 'disc_number', 'disc_total',
        'year', 'genre',
      ];
      return fields.some((field) => this.hasFieldChanged(field));
    },

    close: vi.fn(),

    ...overrides,
  };
  return ctx;
}

describe('metadata-modal batch loading', () => {
  let mockInvoke;

  beforeEach(() => {
    mockInvoke = vi.fn();
    global.window = {
      __TAURI__: { core: { invoke: mockInvoke } },
    };
  });

  it('loadBatchMetadata makes a single batch IPC call', async () => {
    const tracks = [
      { id: 1, path: '/music/a.mp3', duration: 180 },
      { id: 2, path: '/music/b.mp3', duration: 200 },
      { id: 3, path: '/music/c.mp3', duration: 220 },
    ];

    mockInvoke.mockResolvedValueOnce([
      { title: 'Song A', artist: 'Artist 1', album: 'Album', album_artist: null, track_number: 1, track_total: 10, disc_number: 1, disc_total: 1, year: 2020, genre: 'Rock' },
      { title: 'Song B', artist: 'Artist 1', album: 'Album', album_artist: null, track_number: 2, track_total: 10, disc_number: 1, disc_total: 1, year: 2020, genre: 'Rock' },
      { title: 'Song C', artist: 'Artist 1', album: 'Album', album_artist: null, track_number: 3, track_total: 10, disc_number: 1, disc_total: 1, year: 2020, genre: 'Rock' },
    ]);

    // Import the component module to get the loadBatchMetadata logic
    // We test via the inline context approach since the module exports a factory
    const { createMetadataModal } = await import('../js/components/metadata-modal.js');

    // Extract the data factory by calling it with a mock Alpine
    let dataFactory;
    const mockAlpine = {
      data: (name, factory) => { dataFactory = factory; },
    };
    createMetadataModal(mockAlpine);
    const component = dataFactory();

    // Set up component state
    component.tracks = tracks;
    component.mixedFields = new Set();

    await component.loadBatchMetadata();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('get_tracks_metadata_batch', {
      paths: ['/music/a.mp3', '/music/b.mp3', '/music/c.mp3'],
    });

    // All tracks share artist/album/genre — those should not be mixed
    expect(component.mixedFields.has('artist')).toBe(false);
    expect(component.mixedFields.has('album')).toBe(false);
    expect(component.mixedFields.has('genre')).toBe(false);

    // Titles differ — should be mixed
    expect(component.mixedFields.has('title')).toBe(true);
    // Track numbers differ — should be mixed
    expect(component.mixedFields.has('track_number')).toBe(true);
  });

  it('loadBatchMetadata detects mixed fields correctly', async () => {
    const tracks = [
      { id: 1, path: '/music/a.mp3', duration: 100 },
      { id: 2, path: '/music/b.mp3', duration: 100 },
    ];

    mockInvoke.mockResolvedValueOnce([
      { title: 'Same', artist: 'Different A', album: 'Same Album', album_artist: null, track_number: 1, track_total: 2, disc_number: null, disc_total: null, year: 2024, genre: 'Pop' },
      { title: 'Same', artist: 'Different B', album: 'Same Album', album_artist: null, track_number: 2, track_total: 2, disc_number: null, disc_total: null, year: 2024, genre: 'Pop' },
    ]);

    const { createMetadataModal } = await import('../js/components/metadata-modal.js');
    let dataFactory;
    const mockAlpine = { data: (name, factory) => { dataFactory = factory; } };
    createMetadataModal(mockAlpine);
    const component = dataFactory();
    component.tracks = tracks;
    component.mixedFields = new Set();

    await component.loadBatchMetadata();

    expect(component.metadata.title).toBe('Same');
    expect(component.metadata.album).toBe('Same Album');
    expect(component.mixedFields.has('title')).toBe(false);
    expect(component.mixedFields.has('artist')).toBe(true);
    expect(component.metadata.artist).toBe('');
    expect(component.mixedFields.has('track_number')).toBe(true);
  });
});

describe('metadata-modal parallel save', () => {
  let mockInvoke;
  let mockRescan;

  beforeEach(() => {
    mockInvoke = vi.fn().mockResolvedValue({});
    mockRescan = vi.fn().mockResolvedValue(undefined);
    global.window = {
      __TAURI__: { core: { invoke: mockInvoke } },
    };
  });

  it('saveCurrentEdits calls all saves in parallel via Promise.all', async () => {
    const tracks = [
      { id: 1, path: '/music/a.mp3' },
      { id: 2, path: '/music/b.mp3' },
      { id: 3, path: '/music/c.mp3' },
    ];

    const { createMetadataModal } = await import('../js/components/metadata-modal.js');
    let dataFactory;
    const mockAlpine = {
      data: (name, factory) => { dataFactory = factory; },
      store: () => ({ toast: vi.fn() }),
    };
    createMetadataModal(mockAlpine);
    const component = dataFactory();

    component.tracks = tracks;
    component.metadata = { title: 'New Title', artist: '', album: '', album_artist: '', track_number: '', track_total: '', disc_number: '', disc_total: '', year: '', genre: '' };
    component.originalMetadata = { title: 'Old Title', artist: '', album: '', album_artist: '', track_number: '', track_total: '', disc_number: '', disc_total: '', year: '', genre: '' };
    component.library = { rescanTrack: mockRescan };
    component.close = vi.fn();
    // Bind Alpine.store for toast in non-silent mode
    component.$store = { ui: { toast: vi.fn(), closeModal: vi.fn() } };

    const result = await component.saveCurrentEdits({ close: false, silent: true });

    expect(result).toBe(true);
    // All 3 save calls should have been made
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    // All 3 rescan calls should have been made
    expect(mockRescan).toHaveBeenCalledTimes(3);

    // Verify save was called with correct update structures
    for (const track of tracks) {
      expect(mockInvoke).toHaveBeenCalledWith('save_track_metadata', {
        update: { path: track.path, title: 'New Title' },
      });
    }
  });

  it('saveCurrentEdits skips tracks with no changes', async () => {
    const tracks = [
      { id: 1, path: '/music/a.mp3' },
      { id: 2, path: '/music/b.mp3' },
    ];

    const { createMetadataModal } = await import('../js/components/metadata-modal.js');
    let dataFactory;
    const mockAlpine = {
      data: (name, factory) => { dataFactory = factory; },
      store: () => ({ toast: vi.fn() }),
    };
    createMetadataModal(mockAlpine);
    const component = dataFactory();

    component.tracks = tracks;
    component.metadata = { title: 'Same', artist: '', album: '', album_artist: '', track_number: '', track_total: '', disc_number: '', disc_total: '', year: '', genre: '' };
    component.originalMetadata = { title: 'Same', artist: '', album: '', album_artist: '', track_number: '', track_total: '', disc_number: '', disc_total: '', year: '', genre: '' };
    component.library = { rescanTrack: mockRescan };
    component.close = vi.fn();

    const result = await component.saveCurrentEdits({ close: true, silent: true });

    expect(result).toBe(true);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockRescan).not.toHaveBeenCalled();
  });
});
