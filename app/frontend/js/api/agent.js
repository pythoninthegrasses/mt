/**
 * Agent API
 *
 * Conversational playlist generation via local LLM (Ollama + Rig).
 * All operations return graceful fallbacks when not running in Tauri.
 */

import { tauriInvoke } from './shared.js';

export const agent = {
  /**
   * Generate a playlist from a natural language prompt.
   * @param {string} prompt - Natural language description
   * @returns {Promise<{status: string, playlist_id?: number, playlist_name?: string, track_count?: number, message: string}>}
   */
  async generatePlaylist(prompt) {
    const result = await tauriInvoke('agent_generate_playlist', { prompt });
    if (result !== null) return result;
    throw new Error('Agent requires Tauri runtime');
  },

  /**
   * Check agent availability (Ollama running + model present).
   * @returns {Promise<{available: boolean, model: string, message: string}>}
   */
  async checkStatus() {
    const result = await tauriInvoke('agent_check_status');
    if (result !== null) return result;
    return { available: false, model: '', message: 'Agent requires Tauri runtime' };
  },

  /**
   * Check Ollama connectivity and list installed models.
   * @returns {Promise<{connected: boolean, models: string[]}>}
   */
  async checkOllama() {
    const result = await tauriInvoke('agent_check_ollama');
    if (result !== null) return result;
    return { connected: false, models: [] };
  },

  /**
   * Pull a model from Ollama. Emits `agent://pull-progress` events.
   * @param {string} model - Model name (e.g. "llama3.2:1b")
   * @returns {Promise<{success: boolean, model: string, message: string}>}
   */
  async pullModel(model) {
    const result = await tauriInvoke('agent_pull_model', { model });
    if (result !== null) return result;
    throw new Error('Agent requires Tauri runtime');
  },

  /**
   * Get onboarding state from persistent store.
   * @returns {Promise<{completed: boolean, model?: string}>}
   */
  async getOnboardingState() {
    const result = await tauriInvoke('agent_get_onboarding_state');
    if (result !== null) return result;
    return { completed: false, model: null };
  },

  /**
   * Mark onboarding as complete.
   * @param {string|null} model - Model name used
   * @returns {Promise<void>}
   */
  setOnboardingComplete(model = null) {
    return tauriInvoke('agent_set_onboarding_complete', { model });
  },
};
