/**
 * Genius Browser Component
 *
 * Conversational playlist generator using a local LLM (Ollama).
 * Handles onboarding wizard (Ollama check -> model download -> ready)
 * and the natural language prompt interface.
 */

import { agent } from '../api/agent.js';

const DEFAULT_MODEL = 'qwen3.5:9b';

export function createGeniusBrowser(Alpine) {
  Alpine.data('geniusBrowser', () => ({
    // Onboarding state
    onboardingComplete: false,
    onboardingStep: 'checking', // 'checking' | 'install-ollama' | 'download-model' | 'ready'
    ollamaConnected: false,
    ollamaModels: [],
    modelDownloading: false,
    pullProgress: 0,
    pullStatus: '',

    // Prompt state
    prompt: '',
    generating: false,
    result: null, // { status, playlist_id, playlist_name, track_count, message }
    history: [], // past generations for this session

    // Animated prompt cycling
    _animatedText: '',
    _animatedVisible: false,
    _animateTimer: null,
    _promptExamples: [
      'make me a chill playlist from my library',
      'something similar to what I listened to recently',
      "find me post-punk artists I don't usually listen to",
      'upbeat tracks for a morning run',
      'rainy day songs with acoustic guitars',
      "deep cuts I haven't played in months",
      'a late-night driving mix',
      'something moody and atmospheric',
      'high energy tracks for cleaning the house',
      'jazz and soul from the 60s and 70s',
      'songs that build slowly then explode',
      'artists similar to Radiohead in my library',
      'a Sunday morning coffee playlist',
      'tracks with heavy bass lines',
      'my most played songs from this year',
      'something dreamy and shoegaze-y',
      'a workout mix that keeps escalating',
      'underrated albums I barely touched',
      'folksy singer-songwriter vibes',
      "electronic music that isn't too intense",
      'songs to cook dinner to',
      'a road trip playlist from my collection',
      'melancholy but beautiful tracks',
      'hip-hop and R&B from the 90s',
      'everything by female vocalists',
      'instrumental tracks only',
      'songs under three minutes',
      'a party mix from what I already have',
      'blues and classic rock deep cuts',
    ],
    _promptIndex: 0,

    // Event cleanup
    _unlisten: null,

    init() {
      this.$watch('$store.ui.view', (view) => {
        if (view === 'genius' && !this.onboardingComplete) {
          this._checkOnboarding();
        }
      });

      // Check on first load if already on genius view
      if (this.$store.ui.view === 'genius') {
        this._checkOnboarding();
      }

      this._startPromptCycle();
    },

    destroy() {
      if (this._unlisten) {
        this._unlisten();
        this._unlisten = null;
      }
      this._stopPromptCycle();
    },

    get ui() {
      return this.$store.ui;
    },

    // --- Animated prompt cycling ---

    _startPromptCycle() {
      // Fisher-Yates shuffle for a fresh order each session
      for (let i = this._promptExamples.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this._promptExamples[i], this._promptExamples[j]] = [
          this._promptExamples[j],
          this._promptExamples[i],
        ];
      }
      this._promptIndex = 0;
      this._showNextPrompt();
    },

    _stopPromptCycle() {
      if (this._animateTimer) {
        clearTimeout(this._animateTimer);
        this._animateTimer = null;
      }
    },

    _showNextPrompt() {
      // Fade in
      this._animatedText = this._promptExamples[this._promptIndex];
      this._animatedVisible = true;

      // Hold visible for 3.9s, then fade out
      this._animateTimer = setTimeout(() => {
        this._animatedVisible = false;

        // After fade-out completes (1.3s), advance and show next
        this._animateTimer = setTimeout(() => {
          this._promptIndex = (this._promptIndex + 1) % this._promptExamples.length;
          this._showNextPrompt();
        }, 1300);
      }, 3900);
    },

    // --- Onboarding ---

    async _checkOnboarding() {
      this.onboardingStep = 'checking';
      try {
        const state = await agent.getOnboardingState();
        if (state.completed) {
          this.onboardingComplete = true;
          this.onboardingStep = 'ready';
          return;
        }
      } catch (error) {
        console.error('[Genius] Failed to get onboarding state:', error);
      }
      await this.checkOllama();
    },

    async checkOllama() {
      this.onboardingStep = 'checking';
      try {
        const status = await agent.checkOllama();
        this.ollamaConnected = status.connected;
        this.ollamaModels = status.models || [];

        if (!status.connected) {
          this.onboardingStep = 'install-ollama';
          return;
        }

        const hasModel = this.ollamaModels.some((m) => m.startsWith(DEFAULT_MODEL.split(':')[0]));

        if (hasModel) {
          await this._completeOnboarding();
        } else {
          this.onboardingStep = 'download-model';
        }
      } catch (error) {
        console.error('[Genius] Failed to check Ollama:', error);
        this.onboardingStep = 'install-ollama';
      }
    },

    async downloadModel() {
      if (this.modelDownloading) return;
      this.modelDownloading = true;
      this.pullProgress = 0;
      this.pullStatus = 'Starting download...';

      // Listen for progress events
      const tauriEvent = window.__TAURI__?.event;
      if (tauriEvent) {
        try {
          this._unlisten = await tauriEvent.listen('agent://pull-progress', (e) => {
            const { status, completed, total } = e.payload;
            this.pullStatus = status;
            if (completed && total && total > 0) {
              this.pullProgress = Math.round((completed / total) * 100);
            }
          });
        } catch (error) {
          console.error('[Genius] Failed to listen for pull progress:', error);
        }
      }

      try {
        const result = await agent.pullModel(DEFAULT_MODEL);
        if (result.success) {
          this.pullProgress = 100;
          this.pullStatus = 'Download complete';
          await this._completeOnboarding();
        } else {
          this.pullStatus = result.message || 'Download failed';
          this.ui.toast(
            'Failed to download model: ' + (result.message || 'Unknown error'),
            'error',
          );
        }
      } catch (error) {
        console.error('[Genius] Failed to pull model:', error);
        this.pullStatus = 'Download failed';
        this.ui.toast('Failed to download model', 'error');
      } finally {
        this.modelDownloading = false;
        if (this._unlisten) {
          this._unlisten();
          this._unlisten = null;
        }
      }
    },

    async _completeOnboarding() {
      try {
        await agent.setOnboardingComplete(DEFAULT_MODEL);
      } catch (error) {
        console.error('[Genius] Failed to save onboarding state:', error);
      }
      this.onboardingComplete = true;
      this.onboardingStep = 'ready';
    },

    // --- Playlist Generation ---

    async generate() {
      const trimmed = this.prompt.trim();
      if (!trimmed || this.generating) return;

      this.generating = true;
      this.result = null;

      try {
        const response = await agent.generatePlaylist(trimmed);
        this.result = response;

        if (response.status === 'success') {
          this.history.unshift({
            prompt: trimmed,
            playlist_name: response.playlist_name,
            playlist_id: response.playlist_id,
            track_count: response.track_count,
          });
          this.prompt = '';
          // Notify sidebar to refresh playlists
          window.dispatchEvent(new CustomEvent('mt:playlists-updated'));
          this.ui.toast(
            `Created "${response.playlist_name}" with ${response.track_count} tracks`,
            'success',
          );
        } else if (response.status === 'no_ollama') {
          this.onboardingComplete = false;
          this.onboardingStep = 'install-ollama';
        } else if (response.status === 'no_model') {
          this.onboardingComplete = false;
          this.onboardingStep = 'download-model';
        }
      } catch (error) {
        console.error('[Genius] Failed to generate playlist:', error);
        this.result = { status: 'error', message: error.message || 'Failed to generate playlist' };
      } finally {
        this.generating = false;
      }
    },

    navigateToPlaylist(playlistId) {
      const sidebar = document.querySelector('[x-data="sidebar"]');
      const data = sidebar?._x_dataStack?.[0];
      if (data?.loadPlaylist) {
        data.loadPlaylist(`playlist-${playlistId}`);
      } else {
        window.dispatchEvent(
          new CustomEvent('mt:navigate-playlist', { detail: { playlistId } }),
        );
      }
    },
  }));
}

export default createGeniusBrowser;
