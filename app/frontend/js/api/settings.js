/**
 * Settings API
 *
 * Application settings: get, set, update, and reset via Tauri Store.
 */

import { request, tauriInvoke } from './shared.js';

export const settings = {
  /**
   * Get all settings (uses Tauri command)
   * @returns {Promise<{settings: object}>}
   */
  async getAll() {
    const result = await tauriInvoke('settings_get_all');
    if (result !== null) return result;
    return request('/settings');
  },

  /**
   * Get a single setting (uses Tauri command)
   * @param {string} key - Setting key
   * @returns {Promise<{key: string, value: any}>}
   */
  async get(key) {
    const result = await tauriInvoke('settings_get', { key });
    if (result !== null) return result;
    return request(`/settings/${encodeURIComponent(key)}`);
  },

  /**
   * Set a single setting (uses Tauri command)
   * @param {string} key - Setting key
   * @param {any} value - Setting value
   * @returns {Promise<{key: string, value: any}>}
   */
  async set(key, value) {
    const result = await tauriInvoke('settings_set', { key, value });
    if (result !== null) return result;
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
    const result = await tauriInvoke('settings_update', { settings });
    if (result !== null) return result;
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
    const result = await tauriInvoke('settings_reset');
    if (result !== null) return result;
    return request('/settings/reset', {
      method: 'POST',
    });
  },
};
