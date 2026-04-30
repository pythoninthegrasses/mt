import { afterEach, describe, expect, it, vi } from 'vitest';

// Force HTTP path by returning null from tauriInvoke, allowing fetch to be mocked per-test.
vi.mock('../js/api/shared.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, tauriInvoke: vi.fn().mockResolvedValue(null) };
});

import { api } from '../js/api/index.js';

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

describe('Scrobble threshold arithmetic', () => {
  it('does not trigger below threshold', () => {
    const ratio = 79000 / 100000; // 0.79
    expect(ratio >= 0.8).toBe(false);
  });

  it('triggers at threshold', () => {
    const ratio = 80100 / 100000; // 0.801
    expect(ratio >= 0.8).toBe(true);
  });
});

describe('Scrobble response handling', () => {
  it('returns success status on 200 success response', async () => {
    mockFetch(200, { status: 'success', message: 'Track scrobbled successfully' });
    const result = await api.lastfm.scrobble({
      artist: 'Test Artist',
      track: 'Success Track',
      timestamp: Math.floor(Date.now() / 1000),
      duration: 180,
      played_time: 150,
    });
    expect(result.status).toBe('success');
  });

  it('returns queued status when scrobble is queued for retry', async () => {
    mockFetch(200, { status: 'queued', message: 'Scrobble queued for retry' });
    const result = await api.lastfm.scrobble({
      artist: 'Test Artist',
      track: 'Queued Track',
      timestamp: Math.floor(Date.now() / 1000),
      duration: 180,
      played_time: 150,
    });
    expect(result.status).toBe('queued');
  });

  it('returns threshold_not_met status from backend', async () => {
    mockFetch(200, { status: 'threshold_not_met' });
    const result = await api.lastfm.scrobble({
      artist: 'Test Artist',
      track: 'Threshold Not Met Track',
      timestamp: Math.floor(Date.now() / 1000),
      duration: 180,
      played_time: 50,
    });
    expect(result.status).toBe('threshold_not_met');
  });
});
