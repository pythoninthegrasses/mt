/**
 * Unit tests for watched-folders utility functions
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyDirectories,
  extractParentDirectories,
  promptWatchedFolderConfirmation,
} from '../js/utils/watched-folders.js';

describe('extractParentDirectories', () => {
  it('returns immediate parent and grandparent for audio files', () => {
    const paths = ['/Users/lance/Music/Media.localized/Beginbot/song.m4a'];
    const result = extractParentDirectories(paths);
    expect(result).toContain('/Users/lance/Music/Media.localized/Beginbot');
    expect(result).toContain('/Users/lance/Music/Media.localized');
    expect(result).toHaveLength(2);
  });

  it('returns directory itself and its parent for directory paths', () => {
    const paths = ['/Users/lance/Music/Media.localized/Beginbot'];
    const result = extractParentDirectories(paths);
    expect(result).toContain('/Users/lance/Music/Media.localized/Beginbot');
    expect(result).toContain('/Users/lance/Music/Media.localized');
    expect(result).toHaveLength(2);
  });

  it('deduplicates directories from multiple files in the same folder', () => {
    const paths = [
      '/Music/Artist/track1.mp3',
      '/Music/Artist/track2.mp3',
    ];
    const result = extractParentDirectories(paths);
    expect(result).toContain('/Music/Artist');
    expect(result).toContain('/Music');
    expect(result).toHaveLength(2);
  });

  it('handles files from multiple different directories', () => {
    const paths = [
      '/Music/Rock/song.mp3',
      '/Music/Jazz/track.flac',
    ];
    const result = extractParentDirectories(paths);
    expect(result).toContain('/Music/Rock');
    expect(result).toContain('/Music/Jazz');
    expect(result).toContain('/Music');
    expect(result).toHaveLength(3);
  });

  it('handles all supported audio extensions', () => {
    const extensions = ['mp3', 'flac', 'm4a', 'ogg', 'wav', 'aac', 'wma', 'opus'];
    for (const ext of extensions) {
      const result = extractParentDirectories([`/Music/Artist/song.${ext}`]);
      expect(result).toContain('/Music/Artist');
      expect(result).toContain('/Music');
    }
  });

  it('handles case-insensitive extensions', () => {
    const result = extractParentDirectories(['/Music/Artist/song.MP3']);
    expect(result).toContain('/Music/Artist');
    expect(result).toContain('/Music');
  });

  it('returns empty array for root-level paths', () => {
    const result = extractParentDirectories(['/song.mp3']);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(extractParentDirectories([])).toEqual([]);
  });

  it('skips paths without slashes', () => {
    const result = extractParentDirectories(['song.mp3']);
    expect(result).toEqual([]);
  });

  it('does not go above root for shallow paths', () => {
    const result = extractParentDirectories(['/Music/song.mp3']);
    // Immediate parent is /Music, grandparent would be / which is excluded (parentSlash <= 0)
    expect(result).toContain('/Music');
    expect(result).toHaveLength(1);
  });
});

describe('classifyDirectories', () => {
  it('marks exact matches as already watched', () => {
    const result = classifyDirectories(
      ['/Music/Rock'],
      [{ path: '/Music/Rock' }],
    );
    expect(result).toEqual([{ path: '/Music/Rock', alreadyWatched: true }]);
  });

  it('marks subdirectories of watched folders as already watched', () => {
    const result = classifyDirectories(
      ['/Music/Rock/Album'],
      [{ path: '/Music' }],
    );
    expect(result).toEqual([{ path: '/Music/Rock/Album', alreadyWatched: true }]);
  });

  it('marks directories not under watched folders as new', () => {
    const result = classifyDirectories(
      ['/Downloads/Music'],
      [{ path: '/Music' }],
    );
    expect(result).toEqual([{ path: '/Downloads/Music', alreadyWatched: false }]);
  });

  it('does not match partial path prefixes', () => {
    // /MusicExtra should NOT be considered a subdirectory of /Music
    const result = classifyDirectories(
      ['/MusicExtra'],
      [{ path: '/Music' }],
    );
    expect(result).toEqual([{ path: '/MusicExtra', alreadyWatched: false }]);
  });

  it('handles empty watched folders list', () => {
    const result = classifyDirectories(['/Music', '/Downloads'], []);
    expect(result).toEqual([
      { path: '/Music', alreadyWatched: false },
      { path: '/Downloads', alreadyWatched: false },
    ]);
  });

  it('handles empty directories list', () => {
    const result = classifyDirectories([], [{ path: '/Music' }]);
    expect(result).toEqual([]);
  });

  it('classifies mixed directories correctly', () => {
    const result = classifyDirectories(
      ['/Music/Rock', '/Music', '/Downloads/New'],
      [{ path: '/Music' }],
    );
    expect(result).toEqual([
      { path: '/Music/Rock', alreadyWatched: true },
      { path: '/Music', alreadyWatched: true },
      { path: '/Downloads/New', alreadyWatched: false },
    ]);
  });
});

describe('promptWatchedFolderConfirmation', () => {
  let mockInvoke;
  let mockUi;

  beforeEach(() => {
    mockInvoke = vi.fn();
    mockUi = {
      showWatchedFolderConfirm: vi.fn(),
      toast: vi.fn(),
    };

    global.window = {
      __TAURI__: {
        core: { invoke: mockInvoke },
      },
      Alpine: {
        store: vi.fn((name) => {
          if (name === 'ui') return mockUi;
        }),
      },
      dispatchEvent: vi.fn(),
      CustomEvent: class CustomEvent {
        constructor(type) {
          this.type = type;
        }
      },
    };

    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'watched_folders_list') return Promise.resolve([]);
      if (cmd === 'watched_folders_add') return Promise.resolve({ id: 1 });
      return Promise.resolve(null);
    });
  });

  it('does nothing when __TAURI__ is not available', async () => {
    global.window.__TAURI__ = undefined;
    await promptWatchedFolderConfirmation(['/Music/Artist/song.mp3']);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('does nothing when paths produce no directories', async () => {
    await promptWatchedFolderConfirmation([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('skips when all directories are already watched', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'watched_folders_list') {
        return Promise.resolve([{ path: '/Music' }]);
      }
      return Promise.resolve(null);
    });

    await promptWatchedFolderConfirmation(['/Music/Artist/song.mp3']);
    expect(mockUi.showWatchedFolderConfirm).not.toHaveBeenCalled();
  });

  it('shows confirmation dialog with classified directories', async () => {
    mockUi.showWatchedFolderConfirm.mockResolvedValue([]);

    await promptWatchedFolderConfirmation(['/Music/Artist/song.mp3']);

    expect(mockUi.showWatchedFolderConfirm).toHaveBeenCalledWith([
      { path: '/Music/Artist', alreadyWatched: false },
      { path: '/Music', alreadyWatched: false },
    ]);
  });

  it('adds selected folders via invoke', async () => {
    mockUi.showWatchedFolderConfirm.mockResolvedValue(['/Music']);

    await promptWatchedFolderConfirmation(['/Music/Artist/song.mp3']);

    expect(mockInvoke).toHaveBeenCalledWith('watched_folders_add', {
      request: { path: '/Music', mode: 'continuous', cadence_minutes: 10, enabled: true },
    });
  });

  it('shows toast after adding folders', async () => {
    mockUi.showWatchedFolderConfirm.mockResolvedValue(['/Music']);

    await promptWatchedFolderConfirmation(['/Music/Artist/song.mp3']);

    expect(mockUi.toast).toHaveBeenCalledWith('Added 1 folder to watch list', 'success');
  });

  it('dispatches mt:watched-folders-updated event after adding', async () => {
    mockUi.showWatchedFolderConfirm.mockResolvedValue(['/Music']);

    await promptWatchedFolderConfirmation(['/Music/Artist/song.mp3']);

    expect(global.window.dispatchEvent).toHaveBeenCalled();
  });

  it('does not add folders when user skips', async () => {
    mockUi.showWatchedFolderConfirm.mockResolvedValue([]);

    await promptWatchedFolderConfirmation(['/Music/Artist/song.mp3']);

    expect(mockInvoke).not.toHaveBeenCalledWith('watched_folders_add', expect.anything());
    expect(mockUi.toast).not.toHaveBeenCalled();
  });

  it('handles plural toast message for multiple folders', async () => {
    mockUi.showWatchedFolderConfirm.mockResolvedValue(['/Music', '/Downloads']);

    await promptWatchedFolderConfirmation(['/Music/Artist/song.mp3']);

    expect(mockUi.toast).toHaveBeenCalledWith('Added 2 folders to watch list', 'success');
  });

  it('continues adding remaining folders if one fails', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'watched_folders_list') return Promise.resolve([]);
      if (cmd === 'watched_folders_add') {
        if (args.request.path === '/Music/Artist') {
          return Promise.reject(new Error('duplicate'));
        }
        return Promise.resolve({ id: 1 });
      }
      return Promise.resolve(null);
    });

    mockUi.showWatchedFolderConfirm.mockResolvedValue(['/Music/Artist', '/Music']);

    await promptWatchedFolderConfirmation(['/Music/Artist/song.mp3']);

    expect(mockUi.toast).toHaveBeenCalledWith('Added 1 folder to watch list', 'success');
  });
});
