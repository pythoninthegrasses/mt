/**
 * Unit tests for keyboard shortcuts.
 *
 * Verifies that single-letter shortcuts (mute, loop, shuffle) require
 * modifier keys, freeing plain letter keys for type-to-jump navigation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Alpine stores
const mockPlayer = {
  togglePlay: vi.fn(),
  toggleMute: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
  seek: vi.fn(),
  setVolume: vi.fn(),
  volume: 50,
  currentTime: 30000,
};

const mockQueue = {
  cycleLoop: vi.fn(),
  toggleShuffle: vi.fn(),
  stopAfterCurrent: false,
};

const mockUi = {
  view: 'library',
  modal: null,
  toggleSettings: vi.fn(),
  closeModal: vi.fn(),
  toast: vi.fn(),
};

const mockLibrary = {
  searchQuery: '',
  search: vi.fn(),
};

// Capture event listeners registered on document
let keydownHandler = null;

vi.stubGlobal('Alpine', {
  store: vi.fn((name) => {
    const stores = { player: mockPlayer, queue: mockQueue, ui: mockUi, library: mockLibrary };
    return stores[name];
  }),
});

vi.stubGlobal('document', {
  addEventListener: vi.fn((event, handler) => {
    if (event === 'keydown') keydownHandler = handler;
  }),
  querySelector: vi.fn(() => null),
});

vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Mac' });
vi.stubGlobal('window', { dispatchEvent: vi.fn() });
vi.stubGlobal(
  'CustomEvent',
  class CustomEvent {
    constructor(type) {
      this.type = type;
    }
  },
);

// Import after mocks are set up
const { initKeyboardShortcuts, SHORTCUT_DEFINITIONS } = await import('../js/shortcuts.js');

/** Create a mock KeyboardEvent */
function createKeyEvent(code, opts = {}) {
  return {
    code,
    key: opts.key || code.replace('Key', '').toLowerCase(),
    metaKey: opts.metaKey || false,
    ctrlKey: opts.ctrlKey || false,
    altKey: opts.altKey || false,
    shiftKey: opts.shiftKey || false,
    target: opts.target || { tagName: 'DIV', isContentEditable: false },
    preventDefault: vi.fn(),
  };
}

describe('keyboard shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUi.view = 'library';
    mockUi.modal = null;
    mockQueue.stopAfterCurrent = false;
    mockLibrary.searchQuery = '';
    mockPlayer.volume = 50;
    mockPlayer.currentTime = 30000;
    initKeyboardShortcuts();
  });

  describe('modifier-required shortcuts (mute, loop, shuffle)', () => {
    it('should toggle mute on Cmd+Shift+M', () => {
      const event = createKeyEvent('KeyM', { metaKey: true, shiftKey: true });
      keydownHandler(event);
      expect(mockPlayer.toggleMute).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should toggle mute on Ctrl+Shift+M', () => {
      const event = createKeyEvent('KeyM', { ctrlKey: true, shiftKey: true });
      keydownHandler(event);
      expect(mockPlayer.toggleMute).toHaveBeenCalled();
    });

    it('should NOT toggle mute on plain M key', () => {
      const event = createKeyEvent('KeyM');
      keydownHandler(event);
      expect(mockPlayer.toggleMute).not.toHaveBeenCalled();
    });

    it('should cycle loop on Cmd+L', () => {
      const event = createKeyEvent('KeyL', { metaKey: true });
      keydownHandler(event);
      expect(mockQueue.cycleLoop).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should cycle loop on Ctrl+L', () => {
      const event = createKeyEvent('KeyL', { ctrlKey: true });
      keydownHandler(event);
      expect(mockQueue.cycleLoop).toHaveBeenCalled();
    });

    it('should NOT cycle loop on plain L key', () => {
      const event = createKeyEvent('KeyL');
      keydownHandler(event);
      expect(mockQueue.cycleLoop).not.toHaveBeenCalled();
    });

    it('should toggle shuffle on Cmd+Shift+S', () => {
      const event = createKeyEvent('KeyS', { metaKey: true, shiftKey: true });
      keydownHandler(event);
      expect(mockQueue.toggleShuffle).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should toggle shuffle on Ctrl+Shift+S', () => {
      const event = createKeyEvent('KeyS', { ctrlKey: true, shiftKey: true });
      keydownHandler(event);
      expect(mockQueue.toggleShuffle).toHaveBeenCalled();
    });

    it('should NOT toggle shuffle on plain S key', () => {
      const event = createKeyEvent('KeyS');
      keydownHandler(event);
      expect(mockQueue.toggleShuffle).not.toHaveBeenCalled();
    });
  });

  describe('existing shortcuts preserved', () => {
    it('should toggle play on Space', () => {
      const event = createKeyEvent('Space', { key: ' ' });
      keydownHandler(event);
      expect(mockPlayer.togglePlay).toHaveBeenCalled();
    });

    it('should go to next track on ArrowRight', () => {
      const event = createKeyEvent('ArrowRight', { key: 'ArrowRight' });
      keydownHandler(event);
      expect(mockPlayer.next).toHaveBeenCalled();
    });

    it('should keep Cmd+S as stop after current track', () => {
      mockUi.view = 'library';
      const event = createKeyEvent('KeyS', { metaKey: true, key: 's' });
      keydownHandler(event);
      expect(mockQueue.stopAfterCurrent).toBe(true);
      expect(mockQueue.toggleShuffle).not.toHaveBeenCalled();
    });

    it('should toggle settings on Cmd+,', () => {
      const event = createKeyEvent('Comma', { metaKey: true, key: ',' });
      keydownHandler(event);
      expect(mockUi.toggleSettings).toHaveBeenCalled();
    });
  });

  describe('Escape context-aware behavior', () => {
    it('should close settings when view is settings', () => {
      mockUi.view = 'settings';
      const event = createKeyEvent('Escape', { key: 'Escape' });
      keydownHandler(event);
      expect(mockUi.toggleSettings).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should close modal when modal is open', () => {
      mockUi.modal = 'someModal';
      const event = createKeyEvent('Escape', { key: 'Escape' });
      keydownHandler(event);
      expect(mockUi.closeModal).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should clear search query when no modal or settings open', () => {
      mockLibrary.searchQuery = 'test';
      const event = createKeyEvent('Escape', { key: 'Escape' });
      keydownHandler(event);
      expect(mockLibrary.searchQuery).toBe('');
      expect(mockLibrary.search).toHaveBeenCalledWith('');
    });

    it('should do nothing when no modal, settings, or search active', () => {
      mockLibrary.searchQuery = '';
      const event = createKeyEvent('Escape', { key: 'Escape' });
      keydownHandler(event);
      expect(mockUi.toggleSettings).not.toHaveBeenCalled();
      expect(mockUi.closeModal).not.toHaveBeenCalled();
    });
  });

  describe('volume and seek shortcuts', () => {
    it('should increase volume on ArrowUp', () => {
      const event = createKeyEvent('ArrowUp', { key: 'ArrowUp' });
      keydownHandler(event);
      expect(mockPlayer.setVolume).toHaveBeenCalledWith(55);
    });

    it('should decrease volume on ArrowDown', () => {
      const event = createKeyEvent('ArrowDown', { key: 'ArrowDown' });
      keydownHandler(event);
      expect(mockPlayer.setVolume).toHaveBeenCalledWith(45);
    });

    it('should go next on ArrowRight', () => {
      const event = createKeyEvent('ArrowRight', { key: 'ArrowRight' });
      keydownHandler(event);
      expect(mockPlayer.next).toHaveBeenCalled();
    });

    it('should seek forward on Cmd+ArrowRight', () => {
      const event = createKeyEvent('ArrowRight', { key: 'ArrowRight', metaKey: true });
      keydownHandler(event);
      expect(mockPlayer.seek).toHaveBeenCalledWith(35000);
    });

    it('should go previous on ArrowLeft', () => {
      const event = createKeyEvent('ArrowLeft', { key: 'ArrowLeft' });
      keydownHandler(event);
      expect(mockPlayer.previous).toHaveBeenCalled();
    });

    it('should seek back on Cmd+ArrowLeft', () => {
      const event = createKeyEvent('ArrowLeft', { key: 'ArrowLeft', metaKey: true });
      keydownHandler(event);
      expect(mockPlayer.seek).toHaveBeenCalledWith(25000);
    });

    it('should clamp seek back to 0', () => {
      mockPlayer.currentTime = 2000;
      const event = createKeyEvent('ArrowLeft', { key: 'ArrowLeft', metaKey: true });
      keydownHandler(event);
      expect(mockPlayer.seek).toHaveBeenCalledWith(0);
    });
  });

  describe('input suppression', () => {
    it('should NOT trigger playback shortcuts when typing in INPUT', () => {
      const event = createKeyEvent('Space', {
        key: ' ',
        target: { tagName: 'INPUT', isContentEditable: false },
      });
      keydownHandler(event);
      expect(mockPlayer.togglePlay).not.toHaveBeenCalled();
    });

    it('should NOT trigger playback shortcuts when typing in TEXTAREA', () => {
      const event = createKeyEvent('ArrowUp', {
        key: 'ArrowUp',
        target: { tagName: 'TEXTAREA', isContentEditable: false },
      });
      keydownHandler(event);
      expect(mockPlayer.setVolume).not.toHaveBeenCalled();
    });

    it('should still trigger modifier shortcuts in INPUT fields', () => {
      const event = createKeyEvent('KeyM', {
        metaKey: true,
        shiftKey: true,
        target: { tagName: 'INPUT', isContentEditable: false },
      });
      keydownHandler(event);
      expect(mockPlayer.toggleMute).toHaveBeenCalled();
    });
  });

  describe('SHORTCUT_DEFINITIONS', () => {
    it('should list mute as requiring modifier+shift', () => {
      const muteDef = SHORTCUT_DEFINITIONS.find((s) => s.action === 'Mute / Unmute');
      expect(muteDef).toBeDefined();
      expect(muteDef.key).toContain('mod');
      expect(muteDef.key).toContain('Shift');
    });

    it('should list loop as requiring modifier', () => {
      const loopDef = SHORTCUT_DEFINITIONS.find((s) => s.action === 'Cycle loop mode');
      expect(loopDef).toBeDefined();
      expect(loopDef.key).toContain('mod');
    });

    it('should list shuffle as requiring modifier+shift', () => {
      const shuffleDef = SHORTCUT_DEFINITIONS.find((s) => s.action === 'Toggle shuffle');
      expect(shuffleDef).toBeDefined();
      expect(shuffleDef.key).toContain('mod');
      expect(shuffleDef.key).toContain('Shift');
    });
  });
});
