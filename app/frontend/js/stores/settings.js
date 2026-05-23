/**
 * Settings Store
 *
 * Global settings state shared across views, including integration flags
 * that need to be available before the settings view is opened.
 */

import { plex } from '../api/plex.js';

export function createSettingsStore(Alpine) {
  Alpine.store('settings', {
    plex_configured: false,

    init() {
      this._loadPlexConfigured();
    },

    async _loadPlexConfigured() {
      try {
        const config = await plex.getConfig();
        this.plex_configured = config?.status === 'configured' && !!config.url;
      } catch {
        this.plex_configured = false;
      }
    },
  });
}
