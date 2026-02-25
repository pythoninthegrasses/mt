/**
 * Backend API Client - Barrel Re-export
 *
 * Re-exports all domain API modules for backward compatibility.
 * Prefer importing from domain modules directly (e.g., './api/library.js')
 * to reduce coupling.
 */

import { request } from './shared.js';
export { ApiError } from './shared.js';
export { library } from './library.js';
export { queue } from './queue.js';
export { favorites } from './favorites.js';
export { playlists } from './playlists.js';
export { lastfm } from './lastfm.js';
export { settings } from './settings.js';

import { library } from './library.js';
import { queue } from './queue.js';
import { favorites } from './favorites.js';
import { playlists } from './playlists.js';
import { lastfm } from './lastfm.js';
import { settings } from './settings.js';

/**
 * Unified API object (backward compatibility).
 * New code should import domain modules directly.
 */
export const api = {
  health() {
    return request('/health');
  },

  library,
  queue,
  favorites,
  playlists,
  lastfm,
  settings,

  playback: {
    getState() {
      return request('/playback/state');
    },
    updatePosition(position) {
      return request('/playback/position', {
        method: 'POST',
        body: JSON.stringify({ position }),
      });
    },
  },

  preferences: {
    get() {
      return request('/preferences');
    },
    update(prefs) {
      return request('/preferences', {
        method: 'PATCH',
        body: JSON.stringify(prefs),
      });
    },
    getValue(key) {
      return request(`/preferences/${encodeURIComponent(key)}`);
    },
    setValue(key, value) {
      return request(`/preferences/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });
    },
  },

  watchedFolders: {
    list() {
      return request('/watched-folders');
    },
    get(id) {
      return request(`/watched-folders/${id}`);
    },
    add(path, mode = 'continuous', cadenceMinutes = 10, enabled = true) {
      return request('/watched-folders', {
        method: 'POST',
        body: JSON.stringify({
          path,
          mode,
          cadence_minutes: cadenceMinutes,
          enabled,
        }),
      });
    },
    update(id, updates) {
      return request(`/watched-folders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    },
    remove(id) {
      return request(`/watched-folders/${id}`, {
        method: 'DELETE',
      });
    },
    rescan(id) {
      return request(`/watched-folders/${id}/rescan`, {
        method: 'POST',
      });
    },
  },
};

export default api;
