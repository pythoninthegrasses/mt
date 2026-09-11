/**
 * Minimal local feature-flag helper.
 *
 * Flags are booleans under a `jump_reliability_guard`-style key, read at call
 * time so they can be flipped at runtime through:
 *   1. `window.mtFeatureFlags` (inline script or test init script)
 *   2. `ui.featureFlags` overrides set via the Alpine ui store
 *   3. the defaults below
 *
 * Intentionally small — do not grow this into a global flag system.
 */

const DEFAULT_FLAGS = {
  // Coalesce type-to-jump keystrokes, guard stale jump responses, keep the
  // viewport populated during pending jump fetches, and time out slow jumps.
  jump_reliability_guard: false,
};

export function featureEnabled(name, uiStore) {
  const overrides = uiStore?.featureFlags;
  if (overrides && typeof overrides === 'object' && name in overrides) {
    return Boolean(overrides[name]);
  }
  const global = typeof window === 'undefined' ? null : window.mtFeatureFlags;
  if (global && typeof global === 'object' && name in global) {
    return Boolean(global[name]);
  }
  return Boolean(DEFAULT_FLAGS[name]);
}
