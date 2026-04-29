/**
 * Setup file for player property tests
 * This must run BEFORE player.js is imported
 */

import { vi, beforeAll } from 'vitest';
import { createTauriMock } from './mocks/tauri.js';

beforeAll(() => {
  global.window = createTauriMock();
});

vi.mock('../js/api.js', async () => {
  const { createApiMock } = await import('./mocks/api.js');
  return createApiMock();
});
