/**
 * Audio API
 *
 * Audio output device enumeration and selection via Tauri commands.
 */

import { tauriInvoke } from './shared.js';

export const audio = {
  /**
   * List available audio output devices
   * @returns {Promise<{devices: string[]}>}
   */
  async listDevices() {
    const result = await tauriInvoke('audio_list_devices');
    if (result !== null) return result;
    return { devices: [] };
  },

  /**
   * Set the audio output device
   * @param {string|null} deviceName - Device name, or null for system default
   * @returns {Promise<void>}
   */
  setDevice(deviceName) {
    return tauriInvoke('audio_set_device', { deviceName });
  },
};
