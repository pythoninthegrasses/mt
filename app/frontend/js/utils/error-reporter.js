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
    const msg = reason instanceof Error ? reason.message : String(reason);
    const ctx = reason instanceof Error ? reason.stack : undefined;
    reportError('error', `Unhandled rejection: ${msg}`, ctx);
  });
}
