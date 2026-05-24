/**
 * Plex API
 *
 * Server configuration, ping, and library discovery.
 */

import { tauriInvoke } from './shared.js';

export const plex = {
  getConfig() {
    return tauriInvoke('plex_config_get');
  },

  setConfig(url, token, libraries) {
    return tauriInvoke('plex_config_set', { url, token, libraries });
  },

  clearConfig() {
    return tauriInvoke('plex_config_clear');
  },

  ping(url, token) {
    return tauriInvoke('plex_server_ping', { url, token });
  },

  listLibraries(url, token) {
    return tauriInvoke('plex_list_libraries', { url, token });
  },

  downloadTrack(trackId) {
    return tauriInvoke('plex_download_track', { trackId });
  },

  sync() {
    return tauriInvoke('plex_sync');
  },

  setLibraries(libraries) {
    return tauriInvoke('plex_set_libraries', { libraries });
  },

  listLibrariesCurrent() {
    return tauriInvoke('plex_libraries_current');
  },
};
