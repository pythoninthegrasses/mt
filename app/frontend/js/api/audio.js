/**
 * Audio API
 *
 * Audio output device enumeration and selection via Tauri commands.
 */

import { ApiError, invoke } from './shared.js';

export const audio = {
  /**
   * List available audio output devices
   * @returns {Promise<{devices: string[]}>}
   */
  async listDevices() {
    if (invoke) {
      try {
        return await invoke('audio_list_devices');
      } catch (error) {
        console.error('[api.audio.listDevices] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    // No HTTP fallback — audio device selection requires Tauri runtime
    return { devices: [] };
  },

  /**
   * Set the audio output device
   * @param {string|null} deviceName - Device name, or null for system default
   * @returns {Promise<void>}
   */
  async setDevice(deviceName) {
    if (invoke) {
      try {
        return await invoke('audio_set_device', { deviceName });
      } catch (error) {
        console.error('[api.audio.setDevice] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
  },
};
