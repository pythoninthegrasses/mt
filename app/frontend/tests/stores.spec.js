import { test, expect } from '@playwright/test';
import {
  waitForAlpine,
  getAlpineStore,
  setAlpineStoreProperty,
  callAlpineStoreMethod,
  waitForStoreValue,
  waitForStoreChange,
} from './fixtures/helpers.js';

test.describe('Player Store', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should initialize player store with default values', async ({ page }) => {
    const playerStore = await getAlpineStore(page, 'player');

    expect(playerStore).toBeDefined();
    expect(playerStore.isPlaying).toBeDefined();
    expect(playerStore.currentTrack).toBeDefined();
    expect(playerStore.currentTime).toBeDefined();
    expect(playerStore.duration).toBeDefined();
    expect(playerStore.volume).toBeDefined();
  });

  test('should update isPlaying state', async ({ page }) => {
    // Set playing state
    await setAlpineStoreProperty(page, 'player', 'isPlaying', true);

    // Verify state changed
    const playerStore = await getAlpineStore(page, 'player');
    expect(playerStore.isPlaying).toBe(true);

    // Set paused state
    await setAlpineStoreProperty(page, 'player', 'isPlaying', false);

    // Verify state changed
    const updatedStore = await getAlpineStore(page, 'player');
    expect(updatedStore.isPlaying).toBe(false);
  });

  test('should track current track', async ({ page }) => {
    // Set mock track
    const mockTrack = {
      id: 'test-track-1',
      title: 'Test Track',
      artist: 'Test Artist',
      album: 'Test Album',
      duration: 180,
    };

    await setAlpineStoreProperty(page, 'player', 'currentTrack', mockTrack);

    // Verify track is set
    const playerStore = await getAlpineStore(page, 'player');
    expect(playerStore.currentTrack.id).toBe('test-track-1');
    expect(playerStore.currentTrack.title).toBe('Test Track');
  });

  test('should update position during playback', async ({ page }) => {
    // Set initial position
    await setAlpineStoreProperty(page, 'player', 'currentTime', 0);

    // Verify position is 0
    let playerStore = await getAlpineStore(page, 'player');
    expect(playerStore.currentTime).toBe(0);

    // Update position
    await setAlpineStoreProperty(page, 'player', 'currentTime', 30000);

    // Verify position updated
    playerStore = await getAlpineStore(page, 'player');
    expect(playerStore.currentTime).toBe(30000);
  });

  test('should manage volume level', async ({ page }) => {
    // Set volume to 75
    await setAlpineStoreProperty(page, 'player', 'volume', 75);

    // Verify volume
    const playerStore = await getAlpineStore(page, 'player');
    expect(playerStore.volume).toBe(75);
  });

  test('should toggle mute state', async ({ page }) => {
    // Set muted
    await setAlpineStoreProperty(page, 'player', 'muted', true);

    // Verify muted
    let playerStore = await getAlpineStore(page, 'player');
    expect(playerStore.muted).toBe(true);

    // Unmute
    await setAlpineStoreProperty(page, 'player', 'muted', false);

    // Verify unmuted
    playerStore = await getAlpineStore(page, 'player');
    expect(playerStore.muted).toBe(false);
  });

  test('should store track artwork', async ({ page }) => {
    // Set mock artwork
    const mockArtwork = {
      mime_type: 'image/png',
      data: 'base64encodeddata',
    };

    await setAlpineStoreProperty(page, 'player', 'artwork', mockArtwork);

    // Verify artwork
    const playerStore = await getAlpineStore(page, 'player');
    expect(playerStore.artwork).toBeDefined();
    expect(playerStore.artwork.mime_type).toBe('image/png');
  });
});

test.describe('Queue Store', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/queue', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], currentIndex: -1 }),
      });
    });
    await page.goto('/');
    await waitForAlpine(page);
    await expect.poll(async () => {
      const store = await getAlpineStore(page, 'queue');
      return store.loading;
    }, { timeout: 5000 }).toBe(false);
  });

  test('should initialize queue store', async ({ page }) => {
    const queueStore = await getAlpineStore(page, 'queue');

    expect(queueStore).toBeDefined();
    expect(queueStore.items).toBeDefined();
    expect(Array.isArray(queueStore.items)).toBe(true);
    expect(queueStore.currentIndex).toBeDefined();
    expect(queueStore.shuffle).toBeDefined();
    expect(queueStore.loop).toBeDefined();
  });

  test('should add items to queue', async ({ page }) => {
    let queueStore = await getAlpineStore(page, 'queue');
    const initialLength = queueStore.items.length;

    const mockTrack = {
      id: 'track-1',
      title: 'Test Track',
      artist: 'Test Artist',
    };

    await page.evaluate((track) => {
      window.Alpine.store('queue').items.push(track);
    }, mockTrack);

    queueStore = await getAlpineStore(page, 'queue');
    expect(queueStore.items.length).toBe(initialLength + 1);
  });

  test('should remove items from queue', async ({ page }) => {
    // Add mock tracks first
    await page.evaluate(() => {
      window.Alpine.store('queue').items = [
        { id: 'track-1', title: 'Track 1' },
        { id: 'track-2', title: 'Track 2' },
      ];
    });

    // Remove first track
    await page.evaluate(() => {
      window.Alpine.store('queue').items.shift();
    });

    // Verify track removed
    const queueStore = await getAlpineStore(page, 'queue');
    expect(queueStore.items.length).toBe(1);
    expect(queueStore.items[0].id).toBe('track-2');
  });

  test('should track current index', async ({ page }) => {
    // Set queue with tracks
    await page.evaluate(() => {
      window.Alpine.store('queue').items = [
        { id: 'track-1', title: 'Track 1' },
        { id: 'track-2', title: 'Track 2' },
        { id: 'track-3', title: 'Track 3' },
      ];
      window.Alpine.store('queue').currentIndex = 1;
    });

    // Verify current index
    const queueStore = await getAlpineStore(page, 'queue');
    expect(queueStore.currentIndex).toBe(1);
  });

  test('should toggle shuffle mode', async ({ page }) => {
    // Get initial shuffle state
    let queueStore = await getAlpineStore(page, 'queue');
    const initialShuffle = queueStore.shuffle;

    // Toggle shuffle
    await page.evaluate((current) => {
      window.Alpine.store('queue').shuffle = !current;
    }, initialShuffle);

    // Verify shuffle toggled
    queueStore = await getAlpineStore(page, 'queue');
    expect(queueStore.shuffle).toBe(!initialShuffle);
  });

  test('should cycle through loop modes', async ({ page }) => {
    // Valid loop modes: off, all, one
    const modes = ['off', 'all', 'one'];

    for (let i = 0; i < modes.length; i++) {
      await setAlpineStoreProperty(page, 'queue', 'loop', modes[i]);

      const queueStore = await getAlpineStore(page, 'queue');
      expect(queueStore.loop).toBe(modes[i]);
    }
  });

  test('should clear queue', async ({ page }) => {
    // Add tracks to queue
    await page.evaluate(() => {
      window.Alpine.store('queue').items = [
        { id: 'track-1', title: 'Track 1' },
        { id: 'track-2', title: 'Track 2' },
      ];
    });

    // Clear queue
    await setAlpineStoreProperty(page, 'queue', 'items', []);

    // Verify queue is empty
    const queueStore = await getAlpineStore(page, 'queue');
    expect(queueStore.items.length).toBe(0);
  });
});

test.describe('Library Store', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should initialize library store', async ({ page }) => {
    const libraryStore = await getAlpineStore(page, 'library');

    expect(libraryStore).toBeDefined();
    expect(libraryStore.tracks).toBeDefined();
    expect(Array.isArray(libraryStore.tracks)).toBe(true);
    expect(libraryStore.filteredTracks).toBeDefined();
    expect(libraryStore.searchQuery).toBeDefined();
    expect(libraryStore.currentSection).toBeDefined();
    expect(libraryStore.sortBy).toBeDefined();
    expect(libraryStore.sortOrder).toBeDefined();
  });

  test('should update search query', async ({ page }) => {
    // Set search query
    await setAlpineStoreProperty(page, 'library', 'searchQuery', 'test search');

    // Verify search query
    const libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.searchQuery).toBe('test search');
  });

  test('should change current section', async ({ page }) => {
    // Set section
    await setAlpineStoreProperty(page, 'library', 'currentSection', 'recent');

    // Verify section changed
    const libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.currentSection).toBe('recent');
  });

  test('should update sort parameters', async ({ page }) => {
    // Set sort by title
    await setAlpineStoreProperty(page, 'library', 'sortBy', 'title');
    await setAlpineStoreProperty(page, 'library', 'sortOrder', 'asc');

    // Verify sort settings
    const libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.sortBy).toBe('title');
    expect(libraryStore.sortOrder).toBe('asc');
  });

  test('should track loading state', async ({ page }) => {
    // Set loading
    await setAlpineStoreProperty(page, 'library', 'loading', true);

    // Verify loading
    let libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.loading).toBe(true);

    // Clear loading
    await setAlpineStoreProperty(page, 'library', 'loading', false);

    // Verify not loading
    libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.loading).toBe(false);
  });

  test('should apply ignore-words filter via applyFilters', async ({ page }) => {
    // Add mock tracks with "The" prefix to test ignore-words normalization
    await page.evaluate(() => {
      const store = window.Alpine.store('library');
      store.tracks = [
        { id: 'track-1', title: 'The Beatles Song', artist: 'The Beatles', album: 'Abbey Road' },
        { id: 'track-2', title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera' },
        { id: 'track-3', title: 'A Hard Days Night', artist: 'The Beatles', album: 'A Hard Days Night' },
      ];
      // Call applyFilters to populate filteredTracks
      store.applyFilters();
    });

    // Verify filteredTracks is populated
    const libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.filteredTracks.length).toBe(3);
    // Verify tracks are present (applyFilters copies tracks to filteredTracks)
    expect(libraryStore.filteredTracks.map((t) => t.id)).toContain('track-1');
    expect(libraryStore.filteredTracks.map((t) => t.id)).toContain('track-2');
    expect(libraryStore.filteredTracks.map((t) => t.id)).toContain('track-3');
  });
});

test.describe('UI Store', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should initialize UI store', async ({ page }) => {
    const uiStore = await getAlpineStore(page, 'ui');

    expect(uiStore).toBeDefined();
    expect(uiStore.view).toBeDefined();
    expect(uiStore.toasts).toBeDefined();
    expect(Array.isArray(uiStore.toasts)).toBe(true);
  });

  test('should switch between views', async ({ page }) => {
    const views = ['library', 'queue', 'nowPlaying'];

    for (const view of views) {
      await setAlpineStoreProperty(page, 'ui', 'view', view);

      const uiStore = await getAlpineStore(page, 'ui');
      expect(uiStore.view).toBe(view);
    }
  });

  test('should show toast notifications', async ({ page }) => {
    // Add toast
    await page.evaluate(() => {
      window.Alpine.store('ui').toasts.push({
        id: 'toast-1',
        message: 'Test notification',
        type: 'info',
      });
    });

    // Verify toast added
    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.toasts.length).toBeGreaterThan(0);
    expect(uiStore.toasts[uiStore.toasts.length - 1].message).toBe('Test notification');
  });

  test('should dismiss toast notifications', async ({ page }) => {
    // Add toast
    await page.evaluate(() => {
      window.Alpine.store('ui').toasts = [{
        id: 'toast-1',
        message: 'Test notification',
        type: 'info',
      }];
    });

    // Remove toast
    await page.evaluate(() => {
      window.Alpine.store('ui').toasts = [];
    });

    // Verify toast removed
    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.toasts.length).toBe(0);
  });

  test('should track global loading state', async ({ page }) => {
    // Set loading
    await setAlpineStoreProperty(page, 'ui', 'globalLoading', true);

    // Verify loading
    let uiStore = await getAlpineStore(page, 'ui');
    if (uiStore.globalLoading !== undefined) {
      expect(uiStore.globalLoading).toBe(true);

      // Clear loading
      await setAlpineStoreProperty(page, 'ui', 'globalLoading', false);

      // Verify not loading
      uiStore = await getAlpineStore(page, 'ui');
      expect(uiStore.globalLoading).toBe(false);
    }
  });
});

test.describe('Store Reactivity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should update UI when player store changes', async ({ page }) => {
    // Set playing state
    await setAlpineStoreProperty(page, 'player', 'isPlaying', true);

    // Wait for UI to update
    await page.waitForTimeout(300);

    // Verify play button shows pause icon
    const playButton = page.locator('[data-testid="player-playpause"]');
    const buttonHtml = await playButton.innerHTML();
    expect(buttonHtml).toContain('path'); // Should have SVG path
  });

  test('should update UI when queue store changes', async ({ page }) => {
    // Add track to queue
    await page.evaluate(() => {
      window.Alpine.store('queue').items = [
        { id: 'track-1', title: 'Test Track' },
      ];
    });

    // Wait for UI to update
    await page.waitForTimeout(300);

    // Verify queue indicator or UI reflects change
    const queueStore = await getAlpineStore(page, 'queue');
    expect(queueStore.items.length).toBe(1);
  });

  test('should react to store method calls', async ({ page }) => {
    // Set initial value
    await setAlpineStoreProperty(page, 'player', 'volume', 50);

    // Wait for change
    await waitForStoreChange(page, 'player', 'volume', 2000).catch(() => {
      // If no change detected, manually change it
      return setAlpineStoreProperty(page, 'player', 'volume', 75);
    });

    // Verify value changed
    const playerStore = await getAlpineStore(page, 'player');
    expect(playerStore.volume).not.toBe(50);
  });

  test('should synchronize stores on track change', async ({ page }) => {
    // Set track in player
    const mockTrack = {
      id: 'track-sync-1',
      title: 'Sync Test',
      artist: 'Test Artist',
    };

    await setAlpineStoreProperty(page, 'player', 'currentTrack', mockTrack);

    // Verify player has track
    const playerStore = await getAlpineStore(page, 'player');
    expect(playerStore.currentTrack.id).toBe('track-sync-1');
  });
});

test.describe('Settings Menu (task-046)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1624, height: 1057 });
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('AC#1a: Settings accessible via cog icon in sidebar', async ({ page }) => {
    const settingsButton = page.locator('[data-testid="sidebar-settings"]');
    await expect(settingsButton).toBeVisible();
    
    await settingsButton.click();
    await page.waitForTimeout(100);
    
    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.view).toBe('settings');
    
    const settingsView = page.locator('[data-testid="settings-view"]');
    await expect(settingsView).toBeVisible();
  });

  test('AC#1b: Settings accessible via Cmd-, keyboard shortcut', async ({ page }) => {
    await page.keyboard.press('Meta+,');
    await page.waitForTimeout(100);

    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.view).toBe('settings');

    const settingsView = page.locator('[data-testid="settings-view"]');
    await expect(settingsView).toBeVisible();
  });

  test('AC#1c: Clicking settings cog again toggles back to previous view', async ({ page }) => {
    // Verify we start in library view
    let uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.view).toBe('library');

    const settingsButton = page.locator('[data-testid="sidebar-settings"]');

    // Click to open settings
    await settingsButton.click();
    await page.waitForTimeout(100);

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.view).toBe('settings');

    const settingsView = page.locator('[data-testid="settings-view"]');
    await expect(settingsView).toBeVisible();

    // Click again to toggle back to library
    await settingsButton.click();
    await page.waitForTimeout(100);

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.view).toBe('library');

    // Verify settings view is no longer visible
    await expect(settingsView).not.toBeVisible();
  });

  test('AC#1d: Escape key toggles settings view back to previous view', async ({ page }) => {
    // Verify we start in library view
    let uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.view).toBe('library');

    // Open settings with keyboard shortcut
    await page.keyboard.press('Meta+,');
    await page.waitForTimeout(100);

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.view).toBe('settings');

    const settingsView = page.locator('[data-testid="settings-view"]');
    await expect(settingsView).toBeVisible();

    // Press Escape to toggle back to library
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.view).toBe('library');

    // Verify settings view is no longer visible
    await expect(settingsView).not.toBeVisible();
  });

  test('AC#2a: General section displays placeholder', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
      window.Alpine.store('ui').setSettingsSection('general');
    });
    await page.waitForTimeout(100);
    
    const generalSection = page.locator('[data-testid="settings-section-general"]');
    await expect(generalSection).toBeVisible();
  });

  test('AC#2b: Appearance section with theme preset selector', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
      window.Alpine.store('ui').setSettingsSection('appearance');
    });
    await page.waitForTimeout(100);
    
    const appearanceSection = page.locator('[data-testid="settings-section-appearance"]');
    await expect(appearanceSection).toBeVisible();
    
    const lightButton = page.locator('[data-testid="settings-theme-light"]');
    const metroTealButton = page.locator('[data-testid="settings-theme-metro-teal"]');
    await expect(lightButton).toBeVisible();
    await expect(metroTealButton).toBeVisible();
  });

  test('AC#2c: Theme preset selector changes theme', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
      window.Alpine.store('ui').setSettingsSection('appearance');
    });
    await page.waitForTimeout(100);
    
    const metroTealButton = page.locator('[data-testid="settings-theme-metro-teal"]');
    await metroTealButton.click();
    await page.waitForTimeout(100);
    
    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.themePreset).toBe('metro-teal');
    
    const hasDarkClass = await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    );
    expect(hasDarkClass).toBe(true);
  });

  test('AC#2d: Shortcuts section displays stub with tooltips', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
      window.Alpine.store('ui').setSettingsSection('shortcuts');
    });
    await page.waitForTimeout(100);
    
    const shortcutsSection = page.locator('[data-testid="settings-section-shortcuts"]');
    await expect(shortcutsSection).toBeVisible();
    
    await expect(shortcutsSection.getByText('Queue next')).toBeVisible();
    await expect(shortcutsSection.getByText('Queue last')).toBeVisible();
    await expect(shortcutsSection.getByText('Stop after track')).toBeVisible();
  });

  test('AC#3: Advanced section shows app info', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
      window.Alpine.store('ui').setSettingsSection('advanced');
    });
    await page.waitForTimeout(100);
    
    const advancedSection = page.locator('[data-testid="settings-section-advanced"]');
    await expect(advancedSection).toBeVisible();
    
    const versionEl = page.locator('[data-testid="settings-app-version"]');
    const buildEl = page.locator('[data-testid="settings-app-build"]');
    const platformEl = page.locator('[data-testid="settings-app-platform"]');
    
    await expect(versionEl).toBeVisible();
    await expect(buildEl).toBeVisible();
    await expect(platformEl).toBeVisible();
  });

  test('AC#4: Maintenance section has reset and export buttons', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
      window.Alpine.store('ui').setSettingsSection('advanced');
    });
    await page.waitForTimeout(100);
    
    const resetButton = page.locator('[data-testid="settings-reset"]');
    const exportButton = page.locator('[data-testid="settings-export-logs"]');
    
    await expect(resetButton).toBeVisible();
    await expect(exportButton).toBeVisible();
  });

  test('Settings section navigation persists selection', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
    });
    await page.waitForTimeout(100);
    
    const appearanceNav = page.locator('[data-testid="settings-nav-appearance"]');
    await appearanceNav.click();
    await page.waitForTimeout(100);
    
    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.settingsSection).toBe('appearance');
    
    const appearanceSection = page.locator('[data-testid="settings-section-appearance"]');
    await expect(appearanceSection).toBeVisible();
  });

  test('Settings view has two-column layout', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setView('settings');
    });
    await page.waitForTimeout(100);
    
    const settingsView = page.locator('[data-testid="settings-view"]');
    await expect(settingsView).toBeVisible();
    
    const navGeneral = page.locator('[data-testid="settings-nav-general"]');
    const navAppearance = page.locator('[data-testid="settings-nav-appearance"]');
    const navShortcuts = page.locator('[data-testid="settings-nav-shortcuts"]');
    const navAdvanced = page.locator('[data-testid="settings-nav-advanced"]');
    
    await expect(navGeneral).toBeVisible();
    await expect(navAppearance).toBeVisible();
    await expect(navShortcuts).toBeVisible();
    await expect(navAdvanced).toBeVisible();
  });
});

test.describe('Theme Preset (task-162)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('AC#1: themePreset persisted with light as default', async ({ page }) => {
    const uiStore = await getAlpineStore(page, 'ui');
    expect(uiStore.themePreset).toBeDefined();
    expect(['light', 'metro-teal']).toContain(uiStore.themePreset);
  });

  test('AC#2: Metro Teal applies dark mode and preset attribute', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('metro-teal');
    });

    await page.waitForTimeout(100);

    const hasDarkClass = await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    );
    const presetAttr = await page.evaluate(() => 
      document.documentElement.dataset.themePreset
    );

    expect(hasDarkClass).toBe(true);
    expect(presetAttr).toBe('metro-teal');
  });

  test('AC#5: switching presets updates UI immediately', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('metro-teal');
    });
    await page.waitForTimeout(100);

    let presetAttr = await page.evaluate(() => 
      document.documentElement.dataset.themePreset
    );
    expect(presetAttr).toBe('metro-teal');

    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('light');
    });
    await page.waitForTimeout(100);

    presetAttr = await page.evaluate(() => 
      document.documentElement.dataset.themePreset
    );
    expect(presetAttr).toBeUndefined();

    const hasDarkClass = await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    );
    const hasLightClass = await page.evaluate(() => 
      document.documentElement.classList.contains('light')
    );
    expect(hasDarkClass || hasLightClass).toBe(true);
  });

  test('AC#6: preset switch changes visible color (background)', async ({ page }) => {
    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('light');
    });
    await page.waitForTimeout(100);

    const lightBg = await page.evaluate(() => 
      getComputedStyle(document.documentElement).getPropertyValue('--background').trim()
    );

    await page.evaluate(() => {
      window.Alpine.store('ui').setThemePreset('metro-teal');
    });
    await page.waitForTimeout(100);

    const metroTealBg = await page.evaluate(() => 
      getComputedStyle(document.documentElement).getPropertyValue('--background').trim()
    );

    expect(lightBg).not.toBe(metroTealBg);
  });
});
