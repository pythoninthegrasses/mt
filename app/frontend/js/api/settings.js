/**
 * Settings API
 *
 * Application settings: get, set, update, and reset via Tauri Store.
 */

import { ApiError, invoke, request } from './shared.js';

export const settings = {
  /**
   * Get all settings (uses Tauri command)
   * @returns {Promise<{settings: object}>}
   */
  async getAll() {
    if (invoke) {
      try {
        return await invoke('settings_get_all');
      } catch (error) {
        console.error('[api.settings.getAll] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    // Fallback to HTTP (for backwards compatibility)
    return request('/settings');
  },

  /**
   * Get a single setting (uses Tauri command)
   * @param {string} key - Setting key
   * @returns {Promise<{key: string, value: any}>}
   */
  async get(key) {
    if (invoke) {
      try {
        return await invoke('settings_get', { key });
      } catch (error) {
        console.error('[api.settings.get] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request(`/settings/${encodeURIComponent(key)}`);
  },

  /**
   * Set a single setting (uses Tauri command)
   * @param {string} key - Setting key
   * @param {any} value - Setting value
   * @returns {Promise<{key: string, value: any}>}
   */
  async set(key, value) {
    if (invoke) {
      try {
        return await invoke('settings_set', { key, value });
      } catch (error) {
        console.error('[api.settings.set] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request(`/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  },

  /**
   * Update multiple settings at once (uses Tauri command)
   * @param {object} settings - Settings to update
   * @param {number} [settings.volume] - Volume (0-100)
   * @param {boolean} [settings.shuffle] - Shuffle enabled
   * @param {string} [settings.loop_mode] - Loop mode ("none", "all", "one")
   * @param {string} [settings.theme] - Theme name
   * @param {number} [settings.sidebar_width] - Sidebar width (100-500)
   * @param {number} [settings.queue_panel_height] - Queue panel height (100-800)
   * @returns {Promise<{updated: string[]}>}
   */
  async update(settings) {
    if (invoke) {
      try {
        return await invoke('settings_update', { settings });
      } catch (error) {
        console.error('[api.settings.update] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  /**
   * Reset all settings to defaults (uses Tauri command)
   * @returns {Promise<{settings: object}>}
   */
  async reset() {
    if (invoke) {
      try {
        return await invoke('settings_reset');
      } catch (error) {
        console.error('[api.settings.reset] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return request('/settings/reset', {
      method: 'POST',
    });
  },
};
