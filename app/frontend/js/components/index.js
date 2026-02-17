/**
 * Component Registry
 *
 * Registers all Alpine.js components with the Alpine instance.
 * Import this module and call initComponents(Alpine) before Alpine.start().
 */

import { createLibraryBrowser } from './library-browser.js';
import { createPlayerControls } from './player-controls.js';
import { createSidebar } from './sidebar.js';
import { createNowPlayingView } from './now-playing-view.js';
import { createSettingsView, createShortcutsSettings } from './settings-view.js';
import { createMetadataModal } from './metadata-modal.js';
import { createArtistsBrowser } from './artists-browser.js';

export function initComponents(Alpine) {
  createLibraryBrowser(Alpine);
  createPlayerControls(Alpine);
  createSidebar(Alpine);
  createNowPlayingView(Alpine);
  createSettingsView(Alpine);
  createShortcutsSettings(Alpine);
  createMetadataModal(Alpine);
  createArtistsBrowser(Alpine);

  console.log('[components] All components registered');
}

export default initComponents;
