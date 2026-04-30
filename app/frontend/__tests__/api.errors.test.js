import { afterEach, describe, expect, it, vi } from 'vitest';

// Hoist tauriInvoke mock before domain modules import from shared.js.
// This forces all API functions to take the HTTP fallback path, allowing
// fetch to be mocked per-test without window.__TAURI__ being present in Node.
vi.mock('../js/api/shared.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, tauriInvoke: vi.fn().mockResolvedValue(null) };
});

import { api, ApiError } from '../js/api/index.js';

function mockFetch(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      json: vi.fn(async () => (typeof body === 'string' ? JSON.parse(body) : body)),
      text: vi.fn(async () => text),
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('API Error Responses', () => {
  it('should handle 404 response for missing track', async () => {
    mockFetch(404, { error: 'Track not found' });
    await expect(api.library.getTrack(9999)).rejects.toMatchObject({ status: 404 });
  });

  it('should handle malformed JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('not valid json {{{'),
        json: vi.fn(),
      })
    );
    await expect(api.library.getStats()).rejects.toThrow();
  });

  it('should handle empty response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(''),
        json: vi.fn(),
      })
    );
    const result = await api.library.getStats();
    expect(result).toBeNull();
  });
});

describe('Playlist API Error Handling', () => {
  it('should handle playlist creation failure', async () => {
    mockFetch(500, { error: 'Failed to create playlist' });
    await expect(api.playlists.create('Test Playlist')).rejects.toMatchObject({ status: 500 });
  });

  it('should handle playlist deletion failure', async () => {
    mockFetch(403, { error: 'Cannot delete system playlist' });
    await expect(api.playlists.delete(1)).rejects.toThrow();
  });
});

describe('Queue API Error Handling', () => {
  it('should handle queue add failure', async () => {
    mockFetch(500, { error: 'Queue is full' });
    await expect(api.queue.add([1, 2, 3])).rejects.toMatchObject({ status: 500 });
  });

  it('should handle queue clear failure', async () => {
    mockFetch(500, { error: 'Failed to clear queue' });
    await expect(api.queue.clear()).rejects.toThrow();
  });
});

describe('Settings API Error Handling', () => {
  it('should handle settings API failure gracefully', async () => {
    mockFetch(500, { error: 'Settings unavailable' });
    await expect(api.settings.getAll()).rejects.toMatchObject({ status: 500 });
  });
});

describe('Last.fm API Error Handling', () => {
  it('should handle Last.fm scrobble failure', async () => {
    mockFetch(503, { error: 'Last.fm service unavailable' });
    await expect(
      api.lastfm.scrobble({
        artist: 'Test Artist',
        track: 'Test Track',
        timestamp: Math.floor(Date.now() / 1000),
        duration: 180,
        played_time: 180,
      })
    ).rejects.toThrow();
  });

  it('should handle Last.fm auth URL failure', async () => {
    mockFetch(401, { error: 'API key not configured' });
    await expect(api.lastfm.getAuthUrl()).rejects.toMatchObject({ status: 401 });
  });
});

describe('Favorites API Error Handling', () => {
  it('should handle favorites add failure', async () => {
    mockFetch(409, { error: 'Track already favorited' });
    await expect(api.favorites.add(1)).rejects.toMatchObject({ status: 409 });
  });

  it('should handle favorites remove failure for non-favorite track', async () => {
    mockFetch(404, { error: 'Track not in favorites' });
    await expect(api.favorites.remove(9999)).rejects.toMatchObject({ status: 404 });
  });
});

describe('Watched Folders API Error Handling', () => {
  it('should handle watched folders list failure', async () => {
    mockFetch(500, { error: 'Database connection failed' });
    await expect(api.watchedFolders.list()).rejects.toMatchObject({ status: 500 });
  });

  it('should handle watched folder add with invalid path', async () => {
    mockFetch(400, { error: 'Path does not exist' });
    await expect(api.watchedFolders.add('/nonexistent/path')).rejects.toMatchObject({ status: 400 });
  });
});

describe('Concurrent Request Handling', () => {
  it('should handle multiple concurrent API requests', async () => {
    const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }];
    mockFetch(200, { tracks, total: tracks.length, limit: 1000, offset: 0 });

    const responses = await Promise.all([
      api.library.getTracks(),
      api.library.getTracks({ search: 'test' }),
      api.library.getTracks({ sort: 'artist' }),
    ]);

    expect(responses).toHaveLength(3);
    responses.forEach((r) => expect(r.tracks).toHaveLength(tracks.length));
  });
});
