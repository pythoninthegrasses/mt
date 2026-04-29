/**
 * Shared API utilities
 *
 * Common infrastructure used by all domain API modules:
 * ApiError class, HTTP request helper, and Tauri invoke reference.
 */

const API_BASE = 'http://127.0.0.1:8765/api';

// Get Tauri invoke function if available
export const invoke = window.__TAURI__?.core?.invoke;

/**
 * Custom API error class
 */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Make an API request with error handling
 * @param {string} endpoint - API endpoint (e.g., '/library/tracks')
 * @param {object} options - Fetch options
 * @returns {Promise<any>} Response data
 */
export async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new ApiError(response.status, error.detail || 'Request failed');
    }

    // Handle empty responses
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // Network error or other fetch failure
    throw new ApiError(0, `Network error: ${error.message}`);
  }
}

/**
 * Invoke a Tauri command with error handling
 * @param {string} cmd - Tauri command name
 * @param {object} params - Command parameters
 * @returns {Promise<any>} Command result
 */
export async function tauriInvoke(cmd, params = {}) {
  if (!invoke) return null;
  try {
    return await invoke(cmd, params);
  } catch (error) {
    console.error(`[api.tauriInvoke] Tauri error (${cmd}):`, error);
    throw new ApiError(500, error.toString());
  }
}

/**
 * Show a native Tauri confirmation dialog, falling back to window.confirm
 * @param {string} message - Confirmation message
 * @param {object} options - Dialog options (title, kind)
 * @returns {Promise<boolean>} Whether the user confirmed
 */
export async function tauriConfirm(message, options = {}) {
  return (await window.__TAURI__?.dialog?.confirm(message, options)) ??
    window.confirm(message);
}
