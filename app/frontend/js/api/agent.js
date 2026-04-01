/**
 * Agent API
 *
 * Conversational playlist generation via local LLM (Ollama + Rig).
 * All commands return graceful fallbacks when the agent feature is disabled.
 */

import { ApiError, invoke } from './shared.js';

export const agent = {
  /**
   * Generate a playlist from a natural language prompt.
   * @param {string} prompt - Natural language description
   * @returns {Promise<{status: string, playlist_id?: number, playlist_name?: string, track_count?: number, message: string}>}
   */
  async generatePlaylist(prompt) {
    if (invoke) {
      try {
        return await invoke('agent_generate_playlist', { prompt });
      } catch (error) {
        console.error('[api.agent.generatePlaylist] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    throw new ApiError(501, 'Agent requires Tauri runtime');
  },

  /**
   * Check agent availability (Ollama running + model present).
   * @returns {Promise<{available: boolean, model: string, message: string}>}
   */
  async checkStatus() {
    if (invoke) {
      try {
        return await invoke('agent_check_status');
      } catch (error) {
        console.error('[api.agent.checkStatus] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return { available: false, model: '', message: 'Agent requires Tauri runtime' };
  },

  /**
   * Check Ollama connectivity and list installed models.
   * @returns {Promise<{connected: boolean, models: string[]}>}
   */
  async checkOllama() {
    if (invoke) {
      try {
        return await invoke('agent_check_ollama');
      } catch (error) {
        console.error('[api.agent.checkOllama] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return { connected: false, models: [] };
  },

  /**
   * Pull a model from Ollama. Emits `agent://pull-progress` events.
   * @param {string} model - Model name (e.g. "llama3.2:1b")
   * @returns {Promise<{success: boolean, model: string, message: string}>}
   */
  async pullModel(model) {
    if (invoke) {
      try {
        return await invoke('agent_pull_model', { model });
      } catch (error) {
        console.error('[api.agent.pullModel] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    throw new ApiError(501, 'Agent requires Tauri runtime');
  },

  /**
   * Get onboarding state from persistent store.
   * @returns {Promise<{completed: boolean, model?: string}>}
   */
  async getOnboardingState() {
    if (invoke) {
      try {
        return await invoke('agent_get_onboarding_state');
      } catch (error) {
        console.error('[api.agent.getOnboardingState] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
    return { completed: false, model: null };
  },

  /**
   * Mark onboarding as complete.
   * @param {string|null} model - Model name used
   * @returns {Promise<void>}
   */
  async setOnboardingComplete(model = null) {
    if (invoke) {
      try {
        return await invoke('agent_set_onboarding_complete', { model });
      } catch (error) {
        console.error('[api.agent.setOnboardingComplete] Tauri error:', error);
        throw new ApiError(500, error.toString());
      }
    }
  },
};
