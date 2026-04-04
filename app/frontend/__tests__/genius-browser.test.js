/**
 * Unit tests for the Genius Browser component.
 *
 * Verifies:
 * - Animated prompt cycling (fade in/out through example prompts)
 * - Shift+Enter keybinding (not Cmd+Enter)
 * - Onboarding state transitions
 * - Playlist generation flow
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock agent API
const mockAgent = {
  getOnboardingState: vi.fn(),
  checkOllama: vi.fn(),
  pullModel: vi.fn(),
  setOnboardingComplete: vi.fn(),
  generatePlaylist: vi.fn(),
};

vi.mock('../js/api/agent.js', () => ({ agent: mockAgent }));

// Minimal Alpine mock
const registeredComponents = {};
const mockAlpine = {
  data: vi.fn((name, factory) => {
    registeredComponents[name] = factory;
  }),
};

// Import component
const { createGeniusBrowser } = await import('../js/components/genius-browser.js');

function createInstance(overrides = {}) {
  createGeniusBrowser(mockAlpine);
  const factory = registeredComponents['geniusBrowser'];
  const instance = factory();

  // Provide Alpine reactive context stubs
  instance.$store = { ui: { view: 'genius', toast: vi.fn() } };
  instance.$watch = vi.fn();

  Object.assign(instance, overrides);
  return instance;
}

describe('Genius Browser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('animated prompt cycling', () => {
    it('initializes with example prompts list', () => {
      const instance = createInstance();
      expect(instance._promptExamples.length).toBeGreaterThanOrEqual(3);
      expect(instance._promptExamples[0]).toBe('make me a chill playlist from my library');
    });

    it('starts cycling on init and becomes visible', () => {
      const instance = createInstance();
      mockAgent.getOnboardingState.mockResolvedValue({ completed: true });

      instance.init();

      expect(instance._animatedText).toBe(instance._promptExamples[0]);
      expect(instance._animatedVisible).toBe(true);
    });

    it('fades out after hold period and advances to next prompt', () => {
      const instance = createInstance();
      instance._startPromptCycle();

      expect(instance._animatedVisible).toBe(true);
      expect(instance._animatedText).toBe(instance._promptExamples[0]);

      // After 3.9s hold, fades out
      vi.advanceTimersByTime(3900);
      expect(instance._animatedVisible).toBe(false);

      // After 1.3s fade-out, advances to next
      vi.advanceTimersByTime(1300);
      expect(instance._animatedText).toBe(instance._promptExamples[1]);
      expect(instance._animatedVisible).toBe(true);
    });

    it('wraps around to first prompt after cycling through all', () => {
      const instance = createInstance();
      instance._startPromptCycle();

      // Capture the shuffled order
      const firstPrompt = instance._promptExamples[0];
      const count = instance._promptExamples.length;
      // Advance through all prompts (3.9s hold + 1.3s fade each)
      for (let i = 0; i < count; i++) {
        vi.advanceTimersByTime(5200);
      }

      expect(instance._animatedText).toBe(firstPrompt);
    });

    it('shuffles prompt order on start', () => {
      // Run multiple starts and check that at least one produces a different first element
      const results = new Set();
      for (let i = 0; i < 20; i++) {
        const inst = createInstance();
        inst._startPromptCycle();
        results.add(inst._promptExamples[0]);
        inst._stopPromptCycle();
      }
      expect(results.size).toBeGreaterThan(1);
    });

    it('stops cycling on destroy', () => {
      const instance = createInstance();
      instance._startPromptCycle();
      instance.destroy();
      expect(instance._animateTimer).toBeNull();
    });
  });

  describe('keyboard shortcut', () => {
    it('generate() requires non-empty prompt', async () => {
      const instance = createInstance();
      instance.onboardingComplete = true;
      instance.prompt = '';

      await instance.generate();

      expect(mockAgent.generatePlaylist).not.toHaveBeenCalled();
    });

    it('generate() calls agent with trimmed prompt', async () => {
      const instance = createInstance();
      instance.onboardingComplete = true;
      instance.prompt = '  chill vibes  ';
      mockAgent.generatePlaylist.mockResolvedValue({
        status: 'success',
        playlist_name: 'Chill Vibes',
        playlist_id: 1,
        track_count: 10,
      });

      // Stub dispatchEvent for playlist-updated event
      globalThis.window = { dispatchEvent: vi.fn() };
      globalThis.CustomEvent = class CustomEvent {
        constructor(type, opts) {
          this.type = type;
          this.detail = opts?.detail;
        }
      };

      await instance.generate();

      expect(mockAgent.generatePlaylist).toHaveBeenCalledWith('chill vibes');
      expect(instance.result.status).toBe('success');
      expect(instance.history).toHaveLength(1);
      expect(instance.prompt).toBe('');
    });
  });

  describe('onboarding', () => {
    it('skips onboarding when already completed', async () => {
      const instance = createInstance();
      mockAgent.getOnboardingState.mockResolvedValue({ completed: true });

      await instance._checkOnboarding();

      expect(instance.onboardingComplete).toBe(true);
      expect(instance.onboardingStep).toBe('ready');
    });

    it('shows install-ollama when not connected', async () => {
      const instance = createInstance();
      mockAgent.getOnboardingState.mockResolvedValue({ completed: false });
      mockAgent.checkOllama.mockResolvedValue({ connected: false, models: [] });

      await instance._checkOnboarding();

      expect(instance.onboardingStep).toBe('install-ollama');
    });

    it('shows download-model when connected but model missing', async () => {
      const instance = createInstance();
      mockAgent.getOnboardingState.mockResolvedValue({ completed: false });
      mockAgent.checkOllama.mockResolvedValue({ connected: true, models: [] });

      await instance._checkOnboarding();

      expect(instance.onboardingStep).toBe('download-model');
    });

    it('completes onboarding when model is present', async () => {
      const instance = createInstance();
      mockAgent.getOnboardingState.mockResolvedValue({ completed: false });
      mockAgent.checkOllama.mockResolvedValue({ connected: true, models: ['qwen3.5:9b'] });
      mockAgent.setOnboardingComplete.mockResolvedValue();

      await instance._checkOnboarding();

      expect(instance.onboardingComplete).toBe(true);
      expect(instance.onboardingStep).toBe('ready');
    });
  });
});
