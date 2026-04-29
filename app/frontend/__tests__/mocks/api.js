import { vi } from 'vitest';

/**
 * @param {Record<string,unknown>} [overrides] - additional api namespaces to merge in
 */
export function createApiMock(overrides = {}) {
  return {
    api: {
      favorites: {
        check: vi.fn().mockResolvedValue({ is_favorite: false }),
        add: vi.fn().mockResolvedValue({}),
        remove: vi.fn().mockResolvedValue({}),
      },
      library: {
        getArtwork: vi.fn().mockResolvedValue(null),
        updatePlayCount: vi.fn().mockResolvedValue({}),
      },
      lastfm: {
        getSettings: vi.fn().mockResolvedValue({ enabled: false, authenticated: false, scrobble_threshold: 90 }),
        updateNowPlaying: vi.fn().mockResolvedValue({ status: 'disabled' }),
        scrobble: vi.fn().mockResolvedValue({ status: 'disabled' }),
      },
      ...overrides,
    },
  };
}
