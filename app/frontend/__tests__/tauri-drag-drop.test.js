/**
 * Unit tests for Tauri drag-and-drop handler utilities.
 *
 * Tests handleInternalTrackDrop and handleFilesDrop extracted from
 * initTauriDragDrop in main.js.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUi = {
  toast: vi.fn(),
};

const mockLibrary = {
  scan: vi.fn(),
};

const alpineStoreMock = vi.fn((name) => {
  const stores = { ui: mockUi, library: mockLibrary };
  return stores[name];
});

// Stub window with Alpine and other browser globals
vi.stubGlobal('window', {
  Alpine: { store: alpineStoreMock },
  devicePixelRatio: 2,
  _mtDraggedTrackIds: null,
  _mtInternalDragActive: false,
  dispatchEvent: vi.fn(),
});

vi.stubGlobal('document', {
  elementFromPoint: vi.fn(),
});

vi.stubGlobal(
  'CustomEvent',
  class CustomEvent {
    constructor(type) {
      this.type = type;
    }
  },
);

vi.mock('../js/api/playlists.js', () => ({
  playlists: {
    addTracks: vi.fn(),
  },
}));

vi.mock('../js/utils/watched-folders.js', () => ({
  promptToAddWatchedFolders: vi.fn().mockResolvedValue(undefined),
}));

// Must import after mocks are set up
const { handleInternalTrackDrop, handleFilesDrop } = await import(
  '../js/utils/tauri-drag-drop.js'
);
const { playlists } = await import('../js/api/playlists.js');
const { promptToAddWatchedFolders } = await import('../js/utils/watched-folders.js');

describe('handleInternalTrackDrop', () => {
  let mockElement;
  let mockPlaylistButton;

  beforeEach(() => {
    vi.clearAllMocks();
    window.devicePixelRatio = 2;
    window._mtDraggedTrackIds = [1, 2, 3];
    window.dispatchEvent = vi.fn();
    window.Alpine = { store: alpineStoreMock };

    mockPlaylistButton = {
      dataset: { testid: 'sidebar-playlist-42' },
      querySelector: vi.fn(() => ({ textContent: 'My Playlist' })),
    };

    mockElement = {
      closest: vi.fn(() => mockPlaylistButton),
    };

    document.elementFromPoint = vi.fn(() => mockElement);
  });

  it('returns false when drop is not on a playlist element', async () => {
    mockElement.closest.mockReturnValue(null);

    const result = await handleInternalTrackDrop({ x: 200, y: 400 });

    expect(result).toBe(false);
    expect(playlists.addTracks).not.toHaveBeenCalled();
  });

  it('adds tracks to the playlist and shows success toast', async () => {
    playlists.addTracks.mockResolvedValue({ added: 3 });

    const result = await handleInternalTrackDrop({ x: 200, y: 400 });

    expect(result).toBe(true);
    expect(document.elementFromPoint).toHaveBeenCalledWith(100, 200);
    expect(playlists.addTracks).toHaveBeenCalledWith(42, [1, 2, 3]);
    expect(mockUi.toast).toHaveBeenCalledWith(
      'Added 3 tracks to "My Playlist"',
      'success',
    );
    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mt:playlists-updated' }),
    );
  });

  it('shows info toast when all tracks already exist', async () => {
    playlists.addTracks.mockResolvedValue({ added: 0 });

    await handleInternalTrackDrop({ x: 200, y: 400 });

    expect(mockUi.toast).toHaveBeenCalledWith(
      'Tracks already in "My Playlist"',
      'info',
    );
  });

  it('shows singular toast for single track added', async () => {
    window._mtDraggedTrackIds = [1];
    playlists.addTracks.mockResolvedValue({ added: 1 });

    await handleInternalTrackDrop({ x: 200, y: 400 });

    expect(mockUi.toast).toHaveBeenCalledWith(
      'Added 1 track to "My Playlist"',
      'success',
    );
  });

  it('shows error toast on API failure', async () => {
    playlists.addTracks.mockRejectedValue(new Error('network error'));

    const result = await handleInternalTrackDrop({ x: 200, y: 400 });

    expect(result).toBe(true);
    expect(mockUi.toast).toHaveBeenCalledWith(
      'Failed to add tracks to playlist',
      'error',
    );
  });
});

describe('handleFilesDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.Alpine = { store: alpineStoreMock };
  });

  it('scans paths and shows success toast when tracks added', async () => {
    mockLibrary.scan.mockResolvedValue({ added: 5, skipped: 0 });

    await handleFilesDrop(['/music/song.mp3']);

    expect(mockLibrary.scan).toHaveBeenCalledWith(['/music/song.mp3']);
    expect(mockUi.toast).toHaveBeenCalledWith(
      'Added 5 tracks to library',
      'success',
    );
    expect(promptToAddWatchedFolders).toHaveBeenCalledWith(['/music/song.mp3']);
  });

  it('shows info toast when all tracks already in library', async () => {
    mockLibrary.scan.mockResolvedValue({ added: 0, skipped: 3 });

    await handleFilesDrop(['/music/song.mp3']);

    expect(mockUi.toast).toHaveBeenCalledWith(
      'All 3 tracks already in library',
      'info',
    );
  });

  it('shows info toast when no audio files found', async () => {
    mockLibrary.scan.mockResolvedValue({ added: 0, skipped: 0 });

    await handleFilesDrop(['/docs/readme.txt']);

    expect(mockUi.toast).toHaveBeenCalledWith('No audio files found', 'info');
  });

  it('shows error toast on scan failure', async () => {
    mockLibrary.scan.mockRejectedValue(new Error('scan failed'));

    await handleFilesDrop(['/music/song.mp3']);

    expect(mockUi.toast).toHaveBeenCalledWith('Failed to add files', 'error');
  });

  it('does not fail if promptToAddWatchedFolders throws', async () => {
    mockLibrary.scan.mockResolvedValue({ added: 1, skipped: 0 });
    promptToAddWatchedFolders.mockRejectedValue(new Error('watched folder error'));

    await handleFilesDrop(['/music/song.mp3']);

    expect(mockUi.toast).toHaveBeenCalledWith(
      'Added 1 track to library',
      'success',
    );
  });
});
