/**
 * Settings Service
 *
 * Provides a reactive settings interface backed by the Rust settings store.
 * Maintains a local cache for instant UI reads while syncing to backend.
 * Replaces Alpine.$persist for unified settings management.
 */

const invoke = window.__TAURI__?.core?.invoke;
const { listen } = window.__TAURI__?.event ?? { listen: () => Promise.resolve(() => {}) };

class SettingsService {
  constructor() {
    this.cache = new Map();
    this.listeners = new Map();
    this.initialized = false;
    this.initPromise = null;
  }

  /**
   * Initialize the settings service by loading all settings from backend
   * and setting up event listeners for settings changes.
   */
  async init() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    await this.initPromise;
  }

  async _doInit() {
    try {
      // Load all settings from backend
      const response = await invoke('settings_get_all');
      this.cache = new Map(Object.entries(response.settings));

      // Listen for settings changes from backend
      await listen('settings://changed', (event) => {
        const { key, value } = event.payload;
        this.cache.set(key, value);

        // Notify all watchers for this key
        const watchers = this.listeners.get(key) || [];
        watchers.forEach((fn) => fn(value));
      });

      this.initialized = true;
      console.log('[Settings]', 'Initialized with', this.cache.size, 'settings');
    } catch (error) {
      console.error('[Settings]', 'Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Get a setting value from the cache.
   * @param {string} key - Setting key
   * @param {*} defaultValue - Default value if not found
   * @returns {*} Setting value or default
   */
  get(key, defaultValue = null) {
    if (!this.initialized) {
      console.warn('[Settings]', 'get() called before initialization for key:', key);
    }
    return this.cache.has(key) ? this.cache.get(key) : defaultValue;
  }

  /**
   * Set a setting value, updating local cache immediately and syncing to backend.
   * @param {string} key - Setting key
   * @param {*} value - Setting value
   */
  async set(key, value) {
    // Update local cache immediately for instant UI response
    const oldValue = this.cache.get(key);
    this.cache.set(key, value);

    try {
      // Sync to backend asynchronously
      await invoke('settings_set', { key, value });

      // Notify watchers (backend event will also trigger this, but we do it here for immediate feedback)
      const watchers = this.listeners.get(key) || [];
      watchers.forEach((fn) => fn(value));

      console.log('[Settings]', 'Set', key, '=', value);
    } catch (error) {
      console.error('[Settings]', 'Failed to set', key, ':', error);
      // Rollback cache on error
      if (oldValue !== undefined) {
        this.cache.set(key, oldValue);
      } else {
        this.cache.delete(key);
      }
      throw error;
    }
  }

  /**
   * Watch for changes to a specific setting.
   * @param {string} key - Setting key to watch
   * @param {Function} callback - Callback function called with new value
   * @returns {Function} Unwatch function
   */
  watch(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key).push(callback);

    // Return unwatch function
    return () => {
      const watchers = this.listeners.get(key) || [];
      const index = watchers.indexOf(callback);
      if (index > -1) {
        watchers.splice(index, 1);
      }
    };
  }

  /**
   * Create an Alpine-compatible reactive setting.
   * Returns an object with getter/setter that syncs with backend.
   * @param {string} key - Setting key
   * @param {*} defaultValue - Default value
   * @returns {Object} Reactive proxy object
   */
  createReactive(key, defaultValue) {
    // Watch for external changes
    this.watch(key, (_newValue) => {
      // Value is tracked by getter
    });

    return {
      get value() {
        return this.get(key, defaultValue);
      },
      set value(newValue) {
        this.set(key, newValue).catch((err) => {
          console.error('[Settings]', 'Error setting', key, ':', err);
        });
      },
    };
  }

  /**
   * Get all settings as a plain object.
   * @returns {Object} All settings
   */
  getAll() {
    return Object.fromEntries(this.cache);
  }
}

// Export singleton instance
export const settings = new SettingsService();
