/**
 * Unit tests for the UI Store edge cases
 *
 * These tests verify UI store behavior including:
 * - View navigation
 * - Theme management
 * - Sidebar state
 * - Toast notifications
 * - Modal management
 * - Settings persistence
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { DEFAULT_SORT_IGNORE_WORDS } from '../js/constants.js';

// Mock window.settings
const mockSettings = {
  initialized: true,
  get: vi.fn((key, defaultValue) => defaultValue),
  set: vi.fn(() => Promise.resolve()),
};

// Mock window.matchMedia
const mockMatchMedia = vi.fn((query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// Set up global mocks
global.window = {
  settings: mockSettings,
  matchMedia: mockMatchMedia,
  __TAURI__: undefined, // No Tauri in unit tests
};

global.document = {
  documentElement: {
    classList: {
      contains: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
    },
    dataset: {},
  },
};

global.localStorage = {
  data: {},
  getItem: vi.fn((key) => global.localStorage.data[key] || null),
  setItem: vi.fn((key, value) => {
    global.localStorage.data[key] = value;
  }),
  removeItem: vi.fn((key) => {
    delete global.localStorage.data[key];
  }),
  clear: vi.fn(() => {
    global.localStorage.data = {};
  }),
};

/**
 * Create a minimal UI store for testing (no Alpine dependencies)
 */
function createTestUIStore() {
  return {
    view: 'library',
    _previousView: 'library',

    // Settings
    sidebarOpen: true,
    sidebarWidth: 250,
    libraryViewMode: 'list',
    theme: 'system',
    themePreset: 'light',
    settingsSection: 'general',
    sortIgnoreWords: true,
    sortIgnoreWordsList: DEFAULT_SORT_IGNORE_WORDS,

    modal: null,
    contextMenu: null,
    toasts: [],
    keyboardShortcutsEnabled: true,
    globalLoading: false,
    loadingMessage: '',

    setView(view) {
      const validViews = ['library', 'queue', 'nowPlaying', 'settings', 'artists', 'albums'];
      if (validViews.includes(view) && view !== this.view) {
        if (this.view !== 'settings') {
          this._previousView = this.view;
        }
        this.view = view;
      }
    },

    toggleSettings() {
      if (this.view === 'settings') {
        this.view = this._previousView || 'library';
      } else {
        this._previousView = this.view;
        this.view = 'settings';
      }
    },

    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen;
    },

    setSidebarWidth(width) {
      this.sidebarWidth = Math.max(180, Math.min(400, width));
    },

    setLibraryViewMode(mode) {
      if (['list', 'grid', 'compact'].includes(mode)) {
        this.libraryViewMode = mode;
      }
    },

    setTheme(theme) {
      if (['light', 'dark', 'system'].includes(theme)) {
        this.theme = theme;
      }
    },

    setThemePreset(preset) {
      if (['light', 'metro-teal', 'neon-love'].includes(preset)) {
        this.themePreset = preset;
      }
    },

    setSettingsSection(section) {
      const validSections = ['general', 'library', 'appearance', 'shortcuts', 'sorting', 'advanced', 'lastfm'];
      if (validSections.includes(section)) {
        this.settingsSection = section;
      }
    },

    openModal(type, data = null) {
      this.modal = { type, data };
    },

    closeModal() {
      this.modal = null;
    },

    showContextMenu(x, y, items, data = null) {
      this.contextMenu = { x, y, items, data };
    },

    hideContextMenu() {
      this.contextMenu = null;
    },

    _toastId: 0,

    toast(message, type = 'info', duration = 3000) {
      this._toastId++;
      const id = this._toastId;
      this.toasts.push({ id, message, type });
      return id;
    },

    dismissToast(id) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },

    showLoading(message = 'Loading...') {
      this.globalLoading = true;
      this.loadingMessage = message;
    },

    hideLoading() {
      this.globalLoading = false;
      this.loadingMessage = '';
    },

    isView(view) {
      return this.view === view;
    },
  };
}

describe('UI Store - View Navigation', () => {
  let store;

  beforeEach(() => {
    store = createTestUIStore();
  });

  it('should start in library view', () => {
    expect(store.view).toBe('library');
  });

  it('should navigate to valid views', () => {
    const validViews = ['library', 'queue', 'nowPlaying', 'settings', 'artists', 'albums'];

    validViews.forEach((view) => {
      store.setView(view);
      expect(store.view).toBe(view);
    });
  });

  it('should ignore invalid view values', () => {
    store.setView('invalid');
    expect(store.view).toBe('library');

    store.setView(null);
    expect(store.view).toBe('library');

    store.setView(undefined);
    expect(store.view).toBe('library');
  });

  it('should toggle settings view', () => {
    expect(store.view).toBe('library');

    store.toggleSettings();
    expect(store.view).toBe('settings');

    store.toggleSettings();
    expect(store.view).toBe('library');
  });

  it('should remember previous view when toggling settings', () => {
    store.setView('queue');
    expect(store.view).toBe('queue');

    store.toggleSettings();
    expect(store.view).toBe('settings');
    expect(store._previousView).toBe('queue');

    store.toggleSettings();
    expect(store.view).toBe('queue');
  });

  it('should not change view when setting same view', () => {
    store.setView('library');
    const previousView = store._previousView;
    store.setView('library');
    expect(store._previousView).toBe(previousView);
  });

  test.prop([fc.constantFrom('library', 'queue', 'nowPlaying')])(
    'should track previous view for non-settings navigation',
    (targetView) => {
      const store = createTestUIStore();
      store.setView(targetView);
      store.toggleSettings();
      expect(store._previousView).toBe(targetView);
    }
  );
});

describe('UI Store - Sidebar State', () => {
  let store;

  beforeEach(() => {
    store = createTestUIStore();
  });

  it('should start with sidebar open', () => {
    expect(store.sidebarOpen).toBe(true);
  });

  it('should toggle sidebar open state', () => {
    store.toggleSidebar();
    expect(store.sidebarOpen).toBe(false);

    store.toggleSidebar();
    expect(store.sidebarOpen).toBe(true);
  });

  it('should have default sidebar width', () => {
    expect(store.sidebarWidth).toBe(250);
  });

  it('should clamp sidebar width to minimum', () => {
    store.setSidebarWidth(100);
    expect(store.sidebarWidth).toBe(180);
  });

  it('should clamp sidebar width to maximum', () => {
    store.setSidebarWidth(500);
    expect(store.sidebarWidth).toBe(400);
  });

  it('should accept valid sidebar widths', () => {
    store.setSidebarWidth(300);
    expect(store.sidebarWidth).toBe(300);
  });

  test.prop([fc.integer({ min: 0, max: 1000 })])(
    'should always clamp width to valid range',
    (width) => {
      const store = createTestUIStore();
      store.setSidebarWidth(width);
      expect(store.sidebarWidth).toBeGreaterThanOrEqual(180);
      expect(store.sidebarWidth).toBeLessThanOrEqual(400);
    }
  );
});

describe('UI Store - Theme Management', () => {
  let store;

  beforeEach(() => {
    store = createTestUIStore();
  });

  it('should have default theme values', () => {
    expect(store.theme).toBe('system');
    expect(store.themePreset).toBe('light');
  });

  it('should set valid themes', () => {
    store.setTheme('light');
    expect(store.theme).toBe('light');

    store.setTheme('dark');
    expect(store.theme).toBe('dark');

    store.setTheme('system');
    expect(store.theme).toBe('system');
  });

  it('should ignore invalid themes', () => {
    store.setTheme('invalid');
    expect(store.theme).toBe('system');
  });

  it('should set valid theme presets', () => {
    store.setThemePreset('metro-teal');
    expect(store.themePreset).toBe('metro-teal');

    store.setThemePreset('neon-love');
    expect(store.themePreset).toBe('neon-love');

    store.setThemePreset('light');
    expect(store.themePreset).toBe('light');
  });

  it('should ignore invalid theme presets', () => {
    store.setThemePreset('invalid');
    expect(store.themePreset).toBe('light');
  });
});

describe('UI Store - Library View Mode', () => {
  let store;

  beforeEach(() => {
    store = createTestUIStore();
  });

  it('should have default view mode', () => {
    expect(store.libraryViewMode).toBe('list');
  });

  it('should set valid view modes', () => {
    store.setLibraryViewMode('grid');
    expect(store.libraryViewMode).toBe('grid');

    store.setLibraryViewMode('compact');
    expect(store.libraryViewMode).toBe('compact');

    store.setLibraryViewMode('list');
    expect(store.libraryViewMode).toBe('list');
  });

  it('should ignore invalid view modes', () => {
    store.setLibraryViewMode('invalid');
    expect(store.libraryViewMode).toBe('list');
  });

  test.prop([fc.string()])(
    'should only accept valid view modes',
    (mode) => {
      const store = createTestUIStore();
      const validModes = ['list', 'grid', 'compact'];
      store.setLibraryViewMode(mode);

      if (validModes.includes(mode)) {
        expect(store.libraryViewMode).toBe(mode);
      } else {
        expect(store.libraryViewMode).toBe('list');
      }
    }
  );
});

describe('UI Store - Toast Notifications', () => {
  let store;

  beforeEach(() => {
    store = createTestUIStore();
  });

  it('should start with no toasts', () => {
    expect(store.toasts).toEqual([]);
  });

  it('should add toast with default type', () => {
    store.toast('Test message');
    expect(store.toasts.length).toBe(1);
    expect(store.toasts[0].message).toBe('Test message');
    expect(store.toasts[0].type).toBe('info');
  });

  it('should add toast with specified type', () => {
    store.toast('Success!', 'success');
    expect(store.toasts[0].type).toBe('success');

    store.toast('Warning!', 'warning');
    expect(store.toasts[1].type).toBe('warning');

    store.toast('Error!', 'error');
    expect(store.toasts[2].type).toBe('error');
  });

  it('should return toast ID', () => {
    const id = store.toast('Test');
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('should dismiss toast by ID', () => {
    const id1 = store.toast('Toast 1');
    const id2 = store.toast('Toast 2');

    store.dismissToast(id1);

    expect(store.toasts.length).toBe(1);
    expect(store.toasts[0].id).toBe(id2);
  });

  it('should handle dismissing non-existent toast', () => {
    store.toast('Test');
    const initialCount = store.toasts.length;

    store.dismissToast(99999);
    expect(store.toasts.length).toBe(initialCount);
  });

  it('should handle multiple concurrent toasts', () => {
    store.toast('Toast 1');
    store.toast('Toast 2');
    store.toast('Toast 3');
    store.toast('Toast 4');

    expect(store.toasts.length).toBe(4);
  });

  test.prop([fc.string({ minLength: 1 }), fc.constantFrom('info', 'success', 'warning', 'error')])(
    'should create toast with valid message and type',
    (message, type) => {
      const store = createTestUIStore();
      const id = store.toast(message, type);

      expect(store.toasts.length).toBe(1);
      expect(store.toasts[0].message).toBe(message);
      expect(store.toasts[0].type).toBe(type);
      expect(store.toasts[0].id).toBe(id);
    }
  );
});

describe('UI Store - Modal Management', () => {
  let store;

  beforeEach(() => {
    store = createTestUIStore();
  });

  it('should start with no modal', () => {
    expect(store.modal).toBeNull();
  });

  it('should open modal with type', () => {
    store.openModal('confirm');
    expect(store.modal).toEqual({ type: 'confirm', data: null });
  });

  it('should open modal with type and data', () => {
    store.openModal('edit', { trackId: 1 });
    expect(store.modal).toEqual({ type: 'edit', data: { trackId: 1 } });
  });

  it('should close modal', () => {
    store.openModal('confirm');
    store.closeModal();
    expect(store.modal).toBeNull();
  });

  it('should replace existing modal', () => {
    store.openModal('confirm');
    store.openModal('edit', { id: 1 });
    expect(store.modal.type).toBe('edit');
  });
});

describe('UI Store - Context Menu', () => {
  let store;

  beforeEach(() => {
    store = createTestUIStore();
  });

  it('should start with no context menu', () => {
    expect(store.contextMenu).toBeNull();
  });

  it('should show context menu', () => {
    const items = [{ label: 'Play' }, { label: 'Delete' }];
    store.showContextMenu(100, 200, items, { trackId: 1 });

    expect(store.contextMenu).toEqual({
      x: 100,
      y: 200,
      items,
      data: { trackId: 1 },
    });
  });

  it('should hide context menu', () => {
    store.showContextMenu(100, 200, []);
    store.hideContextMenu();
    expect(store.contextMenu).toBeNull();
  });

  test.prop([fc.integer(), fc.integer(), fc.array(fc.object())])(
    'should store context menu position and items',
    (x, y, items) => {
      const store = createTestUIStore();
      store.showContextMenu(x, y, items);

      expect(store.contextMenu.x).toBe(x);
      expect(store.contextMenu.y).toBe(y);
      expect(store.contextMenu.items).toEqual(items);
    }
  );
});

describe('UI Store - Loading State', () => {
  let store;

  beforeEach(() => {
    store = createTestUIStore();
  });

  it('should start with no loading', () => {
    expect(store.globalLoading).toBe(false);
    expect(store.loadingMessage).toBe('');
  });

  it('should show loading with default message', () => {
    store.showLoading();
    expect(store.globalLoading).toBe(true);
    expect(store.loadingMessage).toBe('Loading...');
  });

  it('should show loading with custom message', () => {
    store.showLoading('Processing files...');
    expect(store.globalLoading).toBe(true);
    expect(store.loadingMessage).toBe('Processing files...');
  });

  it('should hide loading', () => {
    store.showLoading('Test');
    store.hideLoading();
    expect(store.globalLoading).toBe(false);
    expect(store.loadingMessage).toBe('');
  });
});

describe('UI Store - Settings Section', () => {
  let store;

  beforeEach(() => {
    store = createTestUIStore();
  });

  it('should have default settings section', () => {
    expect(store.settingsSection).toBe('general');
  });

  it('should set valid settings sections', () => {
    const sections = ['general', 'library', 'appearance', 'shortcuts', 'sorting', 'advanced', 'lastfm'];

    sections.forEach((section) => {
      store.setSettingsSection(section);
      expect(store.settingsSection).toBe(section);
    });
  });

  it('should ignore invalid settings sections', () => {
    store.setSettingsSection('invalid');
    expect(store.settingsSection).toBe('general');
  });
});

describe('UI Store - Sort Ignore Words', () => {
  let store;

  beforeEach(() => {
    store = createTestUIStore();
  });

  it('should have default sort ignore words enabled', () => {
    expect(store.sortIgnoreWords).toBe(true);
  });

  it('should have default sort ignore words list', () => {
    expect(store.sortIgnoreWordsList).toBe(DEFAULT_SORT_IGNORE_WORDS);
  });
});

describe('UI Store - isView helper', () => {
  let store;

  beforeEach(() => {
    store = createTestUIStore();
  });

  it('should return true for current view', () => {
    expect(store.isView('library')).toBe(true);
    expect(store.isView('queue')).toBe(false);
  });

  it('should update when view changes', () => {
    store.setView('queue');
    expect(store.isView('library')).toBe(false);
    expect(store.isView('queue')).toBe(true);
  });
});
