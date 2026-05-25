/**
 * Unit tests for the global error/rejection reporter.
 *
 * The unhandledrejection handler in installGlobalErrorHandlers() previously
 * fell back to `String(reason)`, which yields the useless string
 * "[object Object]" for non-Error rejection reasons (common with Tauri IPC
 * errors that surface as plain objects). This obscures real failures in
 * production logs.
 *
 * These tests pin the diagnostic behavior:
 *   1. Error rejections still surface their message + stack.
 *   2. String rejections surface verbatim.
 *   3. Plain object rejections are JSON-stringified (not "[object Object]").
 *   4. Objects with circular references degrade gracefully without throwing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('error-reporter: unhandledrejection diagnostics', () => {
  let invokeMock;
  let installGlobalErrorHandlers;
  let listeners;

  let originalWindow;

  beforeEach(async () => {
    vi.resetModules();

    invokeMock = vi.fn().mockResolvedValue(undefined);
    listeners = new Map();

    // Build a minimal fake window for the node test environment.
    originalWindow = globalThis.window;
    globalThis.window = {
      __TAURI__: { core: { invoke: invokeMock } },
      addEventListener: (event, fn) => {
        listeners.set(event, fn);
      },
    };

    ({ installGlobalErrorHandlers } = await import('../js/utils/error-reporter.js'));
    installGlobalErrorHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  function dispatchRejection(reason) {
    const handler = listeners.get('unhandledrejection');
    expect(handler).toBeTypeOf('function');
    handler({ reason });
  }

  it('formats Error rejections with message and stack', () => {
    const err = new Error('boom');
    dispatchRejection(err);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [, payload] = invokeMock.mock.calls[0];
    expect(payload.level).toBe('error');
    expect(payload.message).toBe('Unhandled rejection: boom');
    expect(payload.context).toBe(err.stack);
  });

  it('passes through string rejections verbatim', () => {
    dispatchRejection('something failed');

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [, payload] = invokeMock.mock.calls[0];
    expect(payload.message).toBe('Unhandled rejection: something failed');
  });

  it('JSON-stringifies plain object rejections instead of "[object Object]"', () => {
    const reason = { code: 'INVOKE_FAILED', command: 'library_get_all', detail: 'db locked' };
    dispatchRejection(reason);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [, payload] = invokeMock.mock.calls[0];
    expect(payload.message).not.toContain('[object Object]');
    expect(payload.message).toContain('INVOKE_FAILED');
    expect(payload.message).toContain('library_get_all');
    expect(payload.message).toContain('db locked');
  });

  it('handles circular object rejections without throwing', () => {
    const reason = { name: 'cyclic' };
    reason.self = reason;

    expect(() => dispatchRejection(reason)).not.toThrow();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [, payload] = invokeMock.mock.calls[0];
    expect(payload.message).toContain('cyclic');
    expect(payload.message).not.toContain('[object Object]');
  });
});
