/**
 * Shared API utilities
 *
 * Common infrastructure used by all domain API modules:
 * ApiError class, HTTP request helper, and Tauri invoke wrapper.
 */

/**
 * Base URL of the HTTP API, including the `/api` prefix, plus the bearer token
 * every request carries. Both default to the values a locally running sidecar
 * uses and are replaced at runtime by `setBackendEndpoint` with what the Rust
 * side reports (see `sidecar_get_endpoint`). Mutable module state rather than a
 * constant because the port is chosen by the OS, so it is not knowable at build
 * time; the defaults keep `request()` working when there is no Tauri context at
 * all (Vitest runs in Node) or before the injected value arrives.
 */
const DEFAULT_API_BASE = 'http://127.0.0.1:8765';

let apiBase = `${DEFAULT_API_BASE}/api`;
let apiToken = null;

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
 * Replace the base URL and bearer token that `request()` uses.
 *
 * @param {string} baseUrl - Sidecar origin (e.g., 'http://127.0.0.1:43210'); the
 *   `/api` prefix is appended here, so callers pass the origin only. A
 *   falsy value leaves the current base URL untouched.
 * @param {string|null} [token] - Bearer token; omitted or falsy means no
 *   `Authorization` header is sent.
 */
export function setBackendEndpoint(baseUrl, token = null) {
  if (!baseUrl) return;
  apiBase = `${baseUrl.replace(/\/$/, '')}/api`;
  apiToken = token || null;
}

/**
 * Make an API request with error handling
 * @param {string} endpoint - API endpoint (e.g., '/library/tracks')
 * @param {object} options - Fetch options
 * @returns {Promise<any>} Response data
 */
export async function request(endpoint, options = {}) {
  const url = `${apiBase}${endpoint}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  if (apiToken) {
    config.headers.Authorization = `Bearer ${apiToken}`;
  }

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
  const invoke = window.__TAURI__?.core?.invoke;
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
