import { vi } from 'vitest';

const VOID_CMDS = new Set([
  'audio_seek',
  'audio_set_volume',
  'audio_stop',
  'audio_play',
  'audio_pause',
  'queue_clear',
]);

const DEFAULT_RETURNS = {
  audio_get_status: { volume: 1.0 },
  audio_load: { duration_ms: 180000 },
};

/**
 * @param {{ invokeReturns?: Record<string,unknown>, voidCmds?: string[] }} [opts]
 */
export function createTauriMock({ invokeReturns = {}, voidCmds = [] } = {}) {
  const returns = { ...DEFAULT_RETURNS, ...invokeReturns };
  const voidSet = new Set([...VOID_CMDS, ...voidCmds]);
  return {
    __TAURI__: {
      core: {
        invoke: vi.fn((cmd) => {
          if (voidSet.has(cmd)) return Promise.resolve();
          return Promise.resolve(returns[cmd] ?? {});
        }),
      },
      event: {
        listen: vi.fn(() => Promise.resolve(() => {})),
      },
    },
  };
}
