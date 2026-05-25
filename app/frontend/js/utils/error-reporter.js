/**
 * Frontend error reporter — captures unhandled errors and routes them
 * to the backend tracing subscriber via the log_frontend_error command.
 */

const invoke = window.__TAURI__?.core?.invoke;

/**
 * Report an error to the backend logging system.
 * @param {'error'|'warn'|'info'|'debug'} level
 * @param {string} message
 * @param {string} [context] - extra context (stack trace, component name, etc.)
 */
export function reportError(level, message, context) {
  if (!invoke) return;
  invoke('log_frontend_error', { level, message, context }).catch(() => {
    // Swallow — if the backend is down we can't log anyway
  });
}

/**
 * Format a rejection reason that is not an Error instance.
 * Falls back to JSON.stringify so non-Error objects don't collapse to the
 * useless "[object Object]" produced by String(reason).
 * Handles circular references by tagging the cycle and returning a partial
 * representation rather than throwing.
 *
 * @param {unknown} reason - The rejection reason
 * @returns {string} A diagnostic string for logging
 */
function formatRejectionReason(reason) {
  if (typeof reason === 'string') return reason;
  if (reason == null) return String(reason);
  if (typeof reason !== 'object') return String(reason);

  try {
    const seen = new WeakSet();
    const json = JSON.stringify(reason, (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
    // JSON.stringify returns undefined for some inputs (e.g., a bare function).
    if (json === undefined) return String(reason);
    // If JSON.stringify produced "{}" but the object has own keys, include
    // them via Object.keys so we don't lose all diagnostic value.
    if (json === '{}') {
      const keys = Object.keys(reason);
      if (keys.length) return `{${keys.join(',')}}`;
    }
    return json;
  } catch {
    return String(reason);
  }
}

/**
 * Install global error handlers that forward to the backend.
 * Call once at app startup.
 */
export function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    const msg = event.message || String(event.error);
    const ctx = event.error?.stack ||
      `${event.filename}:${event.lineno}:${event.colno}`;
    reportError('error', msg, ctx);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : formatRejectionReason(reason);
    const ctx = reason instanceof Error ? reason.stack : undefined;
    reportError('error', `Unhandled rejection: ${msg}`, ctx);
  });
}
