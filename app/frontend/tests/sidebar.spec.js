import { test, expect } from '@playwright/test';
import {
  waitForAlpine,
  getAlpineStore,
} from './fixtures/helpers.js';
import {
  createPlaylistState,
  setupPlaylistMocks,
  clearApiCalls,
  findApiCalls,
} from './fixtures/mock-playlists.js';

test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
  });

  test('should display sidebar sections', async ({ page }) => {
    // Wait for sidebar to be visible
    await page.waitForSelector('aside[x-data="sidebar"]', { state: 'visible' });

    // Verify sidebar contains library sections
    const librarySections = page.locator('aside button');
    const count = await librarySections.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should navigate between sections', async ({ page }) => {
    await page.waitForSelector('aside[x-data="sidebar"]', { state: 'visible' });

    // Get initial section
    const libraryStore = await getAlpineStore(page, 'library');
    const initialSection = libraryStore.currentSection;
    expect(initialSection).toBe('all'); // Default section is 'all'

    // Click a different section using data-testid (e.g., 'liked')
    const likedSection = page.locator('[data-testid="sidebar-section-liked"]');
    await likedSection.click();

    // Wait for store to update (web-first assertion)
    await expect.poll(async () => {
      const store = await getAlpineStore(page, 'library');
      return store.currentSection;
    }, { timeout: 5000 }).toBe('liked');
  });

  test('should highlight active section', async ({ page }) => {
    await page.waitForSelector('aside[x-data="sidebar"]', { state: 'visible' });

    const musicSection = page.locator('[data-testid="sidebar-section-all"]');
    await musicSection.click();

    await expect.poll(async () => {
      const classes = await musicSection.getAttribute('class');
      return classes?.includes('bg-primary');
    }, { timeout: 5000 }).toBe(true);
  });

  test('should show section icons', async ({ page }) => {
    await page.waitForSelector('aside[x-data="sidebar"]', { state: 'visible' });

    // Verify sections have icons (SVG elements)
    const sectionIcons = page.locator('aside button svg');
    const count = await sectionIcons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should show section labels when expanded', async ({ page }) => {
    await page.waitForSelector('aside[x-data="sidebar"]', { state: 'visible' });

    // Ensure sidebar is expanded
    const sidebarStore = await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      if (sidebar.isCollapsed) {
        sidebar.toggleCollapse();
      }
      return sidebar;
    });

    // Verify section labels are visible
    const sectionLabels = page.locator('aside button span');
    const count = await sectionLabels.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Sidebar Collapse/Expand', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('aside[x-data="sidebar"]', { state: 'visible' });
  });

  test('should collapse sidebar when clicking collapse button', async ({ page }) => {
    // Ensure sidebar starts expanded
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.isCollapsed = false;
    });

    // Get initial width
    const sidebar = page.locator('aside[x-data="sidebar"]');
    const initialBox = await sidebar.boundingBox();

    // Click collapse button
    const collapseButton = page.locator('aside button[title*="Collapse"], aside button[title*="Expand"]').last();
    await collapseButton.click();

    // Wait for transition
    await page.waitForTimeout(300);

    // Verify sidebar width changed
    const collapsedBox = await sidebar.boundingBox();
    expect(collapsedBox.width).toBeLessThan(initialBox.width);
  });

  test('should expand sidebar when clicking expand button', async ({ page }) => {
    // Collapse sidebar first
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.isCollapsed = true;
    });

    await page.waitForTimeout(300);

    // Get collapsed width
    const sidebar = page.locator('aside[x-data="sidebar"]');
    const collapsedBox = await sidebar.boundingBox();

    // Click expand button
    const expandButton = page.locator('aside button[title*="Expand"], aside button[title*="Collapse"]').last();
    await expandButton.click();

    // Wait for transition
    await page.waitForTimeout(300);

    // Verify sidebar width increased
    const expandedBox = await sidebar.boundingBox();
    expect(expandedBox.width).toBeGreaterThan(collapsedBox.width);
  });

  test('should hide section labels when collapsed', async ({ page }) => {
    // Collapse sidebar
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.isCollapsed = true;
    });

    await page.waitForTimeout(300);

    // Verify labels are hidden
    const sectionLabels = page.locator('aside button span:not([x-show="isCollapsed"])');
    const visible = await sectionLabels.first().isVisible().catch(() => false);
    expect(visible).toBe(false);
  });

  test('should show only icons when collapsed', async ({ page }) => {
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.isCollapsed = true;
    });

    await expect.poll(async () => {
      const sidebar = page.locator('aside[x-data="sidebar"]');
      const box = await sidebar.boundingBox();
      return box && box.width < 100;
    }, { timeout: 5000 }).toBe(true);

    const sectionIcon = page.locator('[data-testid="sidebar-section-all"] svg');
    await expect(sectionIcon).toBeVisible();
  });

  test('should persist collapse state in session', async ({ page }) => {
    // NOTE: Cross-reload persistence requires Tauri backend (window.settings API).
    // In browser mode, we verify that toggle updates the component state correctly.

    // Get initial collapsed state
    const isCollapsedInitial = await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      return sidebar.isCollapsed;
    });

    // Toggle collapse
    const collapseButton = page.locator('aside button').last();
    await collapseButton.click();
    await page.waitForTimeout(300);

    // Get collapsed state after toggle
    const isCollapsedAfter = await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      return sidebar.isCollapsed;
    });

    // Verify state was toggled
    expect(isCollapsedAfter).toBe(!isCollapsedInitial);

    // Toggle back
    await collapseButton.click();
    await page.waitForTimeout(300);

    // Verify state returned to initial
    const isCollapsedFinal = await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      return sidebar.isCollapsed;
    });

    expect(isCollapsedFinal).toBe(isCollapsedInitial);
  });
});

test.describe('Search Input', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('aside[x-data="sidebar"]', { state: 'visible' });
  });

  test('should show search input in sidebar', async ({ page }) => {
    // Verify search input exists
    const searchInput = page.locator('aside input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible();
  });

  test('should update library search when typing', async ({ page }) => {
    const searchInput = page.locator('aside input[placeholder*="Search"]');
    await searchInput.fill('test query');

    // Wait for debounce
    await page.waitForTimeout(500);

    // Verify library search is updated
    const libraryStore = await getAlpineStore(page, 'library');
    expect(libraryStore.searchQuery).toBe('test query');
  });

  test('should show clear button when search has value', async ({ page }) => {
    const searchInput = page.locator('aside input[placeholder*="Search"]');
    await searchInput.fill('query');

    // Verify clear button appears
    const clearButton = page.locator('aside button:near(input[placeholder*="Search"])');
    await expect(clearButton.first()).toBeVisible();
  });

  test('should clear search when clicking clear button', async ({ page }) => {
    const searchInput = page.locator('aside input[placeholder*="Search"]');
    await searchInput.fill('query');
    await page.waitForTimeout(500);

    // Click clear button
    const clearButton = page.locator('aside input[placeholder*="Search"] ~ button').first();
    await clearButton.click();

    // Verify search is cleared
    const value = await searchInput.inputValue();
    expect(value).toBe('');
  });

  test('should hide search input when sidebar is collapsed', async ({ page }) => {
    // Ensure sidebar is expanded first
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.isCollapsed = false;
    });

    // Verify search is visible
    let searchInput = page.locator('aside input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible();

    // Collapse sidebar
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.isCollapsed = true;
    });

    await page.waitForTimeout(300);

    // Verify search is hidden
    searchInput = page.locator('aside input[placeholder*="Search"]');
    const visible = await searchInput.isVisible().catch(() => false);
    expect(visible).toBe(false);
  });
});

test.describe('Playlists Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('aside[x-data="sidebar"]', { state: 'visible' });
  });

  test('should show playlists section header', async ({ page }) => {
    // Verify playlists header exists
    const playlistsHeader = page.locator('aside:has-text("Playlists")');
    await expect(playlistsHeader).toBeVisible();
  });

  test('should show create playlist button', async ({ page }) => {
    // Verify create button exists (+ icon)
    const createButton = page.locator('aside button[title*="Playlist"]');
    const count = await createButton.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should show empty state when no playlists', async ({ page }) => {
    // Set playlists to empty
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.playlists = [];
    });

    await page.waitForTimeout(300);

    // Verify empty message
    const emptyMessage = page.locator('aside:has-text("No playlists")');
    await expect(emptyMessage).toBeVisible();
  });

  test('should list playlists when available', async ({ page }) => {
    // Add mock playlists with correct data structure (id for section, playlistId for API)
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.playlists = [
        { id: 'playlist-1', playlistId: 1, name: 'Test Playlist 1' },
        { id: 'playlist-2', playlistId: 2, name: 'Test Playlist 2' },
      ];
    });

    await page.waitForTimeout(300);

    // Verify playlists are displayed
    const playlistItems = page.locator('aside button:has-text("Test Playlist")');
    const count = await playlistItems.count();
    expect(count).toBe(2);
  });

  test('should highlight active playlist', async ({ page }) => {
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.playlists = [
        { id: 'playlist-1', playlistId: 1, name: 'Test Playlist 1' },
      ];
      sidebar.activeSection = 'playlist-1';
    });

    await page.waitForTimeout(300);

    const playlistButton = page.locator('aside button:has-text("Test Playlist 1")');
    const classes = await playlistButton.getAttribute('class');
    expect(classes).toContain('bg-primary');
  });

  test('should navigate to playlist when clicked', async ({ page }) => {
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.playlists = [
        { id: 'playlist-1', playlistId: 1, name: 'Test Playlist 1' },
      ];
    });

    await page.waitForTimeout(300);

    const playlistButton = page.locator('aside button:has-text("Test Playlist 1")');
    await playlistButton.click();

    await page.waitForTimeout(300);

    const sidebarData = await page.evaluate(() => {
      return window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
    });

    expect(sidebarData.activeSection).toBe('playlist-1');
  });

  test('should show context menu on right-click (task-147)', async ({ page }) => {
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.playlists = [
        { id: 'playlist-1', playlistId: 1, name: 'Test Playlist' },
      ];
    });

    await page.waitForTimeout(300);

    const playlistButton = page.locator('aside button:has-text("Test Playlist")');
    await playlistButton.click({ button: 'right' });

    await page.waitForTimeout(200);

    const contextMenu = page.locator('[data-testid="playlist-context-menu"]');
    await expect(contextMenu).toBeVisible();

    const renameOption = page.locator('[data-testid="playlist-rename"]');
    await expect(renameOption).toBeVisible();

    const deleteOption = page.locator('[data-testid="playlist-delete"]');
    await expect(deleteOption).toBeVisible();
  });

  test('should hide context menu when clicking away (task-147)', async ({ page }) => {
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.playlists = [
        { id: 'playlist-1', playlistId: 1, name: 'Test Playlist' },
      ];
    });

    await page.waitForTimeout(300);

    const playlistButton = page.locator('aside button:has-text("Test Playlist")');
    await playlistButton.click({ button: 'right' });

    await page.waitForTimeout(200);

    const contextMenu = page.locator('[data-testid="playlist-context-menu"]');
    await expect(contextMenu).toBeVisible();

    await page.click('main');
    await page.waitForTimeout(200);

    await expect(contextMenu).not.toBeVisible();
  });

  test('should hide context menu on escape key (task-147)', async ({ page }) => {
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.playlists = [
        { id: 'playlist-1', playlistId: 1, name: 'Test Playlist' },
      ];
    });

    await page.waitForTimeout(300);

    const playlistButton = page.locator('aside button:has-text("Test Playlist")');
    await playlistButton.click({ button: 'right' });

    await page.waitForTimeout(200);

    const contextMenu = page.locator('[data-testid="playlist-context-menu"]');
    await expect(contextMenu).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await expect(contextMenu).not.toBeVisible();
  });
});

test.describe('Playlist Feature Parity (task-150)', () => {
  let playlistState;

  test.beforeAll(() => {
    playlistState = createPlaylistState();
  });

  test.beforeEach(async ({ page }) => {
    clearApiCalls(playlistState);
    await setupPlaylistMocks(page, playlistState);
    await page.route('**/api/library**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tracks: [
            { id: 101, title: 'Track A', artist: 'Artist A', album: 'Album A', duration: 180, filepath: '/music/track-a.mp3' },
            { id: 102, title: 'Track B', artist: 'Artist B', album: 'Album B', duration: 200, filepath: '/music/track-b.mp3' },
          ],
          total: 2,
        }),
      });
    });
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('aside[x-data="sidebar"]', { state: 'visible' });
  });

  test('AC#1-2: should show inline rename input when creating playlist', async ({ page }) => {
    const createButton = page.locator('[data-testid="create-playlist"]');
    await createButton.click();
    await page.waitForTimeout(500);

    const renameInput = page.locator('[data-testid="playlist-rename-input"]');
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toBeFocused();

    const generateNameCalls = findApiCalls(playlistState, 'GET', '/playlists/generate-name');
    expect(generateNameCalls.length).toBeGreaterThan(0);
  });

  test('AC#1-2: should commit rename on Enter key and call API', async ({ page }) => {
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.editingPlaylist = { id: 'playlist-1', playlistId: 1, name: 'Test Playlist 1' };
      sidebar.editingName = 'Test Playlist 1';
    });

    await page.waitForTimeout(300);

    const renameInput = page.locator('[data-testid="playlist-rename-input"]');
    await renameInput.fill('Renamed Playlist');
    await renameInput.press('Enter');

    await page.waitForTimeout(300);
    await expect(renameInput).not.toBeVisible();

    const renameCalls = findApiCalls(playlistState, 'PUT', '/playlists/1');
    expect(renameCalls.length).toBeGreaterThan(0);
    expect(renameCalls[0].body.name).toBe('Renamed Playlist');
  });

  test('AC#1-2: should cancel rename on Escape key', async ({ page }) => {
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.editingPlaylist = { id: 'playlist-1', playlistId: 1, name: 'Test Playlist 1' };
      sidebar.editingName = 'Test Playlist 1';
    });

    await page.waitForTimeout(300);

    const renameInput = page.locator('[data-testid="playlist-rename-input"]');
    await renameInput.fill('Changed Name');
    await renameInput.press('Escape');

    await page.waitForTimeout(300);
    await expect(renameInput).not.toBeVisible();

    const renameCalls = findApiCalls(playlistState, 'PUT', '/playlists/');
    expect(renameCalls.length).toBe(0);
  });

  test('AC#4-5: playlist should highlight on drag over', async ({ page }) => {
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.dragOverPlaylistId = 1;
    });

    await page.waitForTimeout(300);

    const playlistButton = page.locator('[data-testid="sidebar-playlist-1"]');
    const classes = await playlistButton.getAttribute('class');
    expect(classes).toContain('ring-2');
    expect(classes).toContain('ring-primary');
  });

  test('AC#6: should show drag handle in playlist view', async ({ page }) => {
    await page.evaluate(() => {
      const libraryBrowser = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      libraryBrowser.currentPlaylistId = 1;
    });

    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const dragHandle = page.locator('[data-track-id] .cursor-grab').first();
    await expect(dragHandle).toBeVisible();
  });

  test('AC#6: should hide drag handle outside playlist view', async ({ page }) => {
    await page.evaluate(() => {
      const libraryBrowser = window.Alpine.$data(document.querySelector('[x-data="libraryBrowser"]'));
      libraryBrowser.currentPlaylistId = null;
    });

    await page.waitForSelector('[data-track-id]', { state: 'visible' });

    const dragHandle = page.locator('[data-track-id] .cursor-grab').first();
    await expect(dragHandle).not.toBeVisible();
  });

  test('AC#4: drag tracks to sidebar playlist triggers API call', async ({ page }) => {
    await page.waitForSelector('[data-track-id]', { state: 'visible' });
    await page.waitForTimeout(300);

    const trackRow = page.locator('[data-track-id]').first();
    const playlistButton = page.locator('[data-testid="sidebar-playlist-1"]');

    await trackRow.dragTo(playlistButton);

    await page.waitForTimeout(300);

    const addTracksCalls = findApiCalls(playlistState, 'POST', '/playlists/1/tracks');
    expect(addTracksCalls.length).toBeGreaterThan(0);
  });

  test('right-click playlist should not change active section', async ({ page }) => {
    // Playlists are loaded from mock API in beforeEach
    // Set activeSection to 'all' to verify right-click doesn't change it
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.activeSection = 'all';
    });

    await page.waitForTimeout(300);

    const initialSection = await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      return sidebar.activeSection;
    });

    expect(initialSection).toBe('all');

    const playlistButton = page.locator('[data-testid="sidebar-playlist-1"]');
    await playlistButton.click({ button: 'right' });

    await page.waitForTimeout(300);

    const afterRightClick = await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      return sidebar.activeSection;
    });

    expect(afterRightClick).toBe('all');
  });

  test('playlist buttons should have reorder index attribute', async ({ page }) => {
    await page.waitForTimeout(300);

    const playlistButton = page.locator('[data-testid="sidebar-playlist-1"]');
    const reorderIndex = await playlistButton.getAttribute('data-playlist-reorder-index');
    expect(reorderIndex).toBe('0');
  });

  test('playlist should shift down when dragging from above', async ({ page }) => {
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.reorderDraggingIndex = 0;
      sidebar.reorderDragOverIndex = 2;
    });

    await page.waitForTimeout(300);

    const playlistB = page.locator('[data-testid="sidebar-playlist-2"]');
    const classes = await playlistB.getAttribute('class');
    expect(classes).toContain('playlist-shift-up');
  });

  test('playlist should shift up when dragging from below', async ({ page }) => {
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.reorderDraggingIndex = 2;
      sidebar.reorderDragOverIndex = 0;
    });

    await page.waitForTimeout(300);

    const playlistA = page.locator('[data-testid="sidebar-playlist-1"]');
    const playlistB = page.locator('[data-testid="sidebar-playlist-2"]');
    const classesA = await playlistA.getAttribute('class');
    const classesB = await playlistB.getAttribute('class');
    expect(classesA).toContain('playlist-shift-down');
    expect(classesB).toContain('playlist-shift-down');
  });

  test('dragging playlist should show opacity change', async ({ page }) => {
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.reorderDraggingIndex = 0;
    });

    await page.waitForTimeout(300);

    // Check a different playlist (not the one being dragged)
    // Playlist 1 is at index 0, so check playlist 2 (at index 1)
    const playlistButton = page.locator('[data-testid="sidebar-playlist-2"]');
    const classes = await playlistButton.getAttribute('class');
    expect(classes).toContain('opacity-50');
  });

  test('sidebar has reorder handlers defined', async ({ page }) => {
    const result = await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      return {
        hasStartReorder: typeof sidebar.startPlaylistReorder === 'function',
        hasUpdateTarget: typeof sidebar.updatePlaylistReorderTarget === 'function',
        hasFinishReorder: typeof sidebar.finishPlaylistReorder === 'function',
        hasGetReorderClass: typeof sidebar.getPlaylistReorderClass === 'function',
        hasIsDragging: typeof sidebar.isPlaylistDragging === 'function',
      };
    });

    expect(result.hasStartReorder).toBe(true);
    expect(result.hasUpdateTarget).toBe(true);
    expect(result.hasFinishReorder).toBe(true);
    expect(result.hasGetReorderClass).toBe(true);
    expect(result.hasIsDragging).toBe(true);
  });

  test('should rename playlist via context menu click', async ({ page }) => {
    const playlist1 = page.locator('[data-testid="sidebar-playlist-1"]');
    await playlist1.click({ button: 'right' });

    const renameOption = page.locator('[data-testid="playlist-rename"]');
    await expect(renameOption).toBeVisible();
    await renameOption.click();

    const renameInput = page.locator('[data-testid="playlist-rename-input"]');
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toBeFocused();

    await renameInput.fill('Context Menu Renamed');
    await renameInput.press('Enter');

    await page.waitForTimeout(300);

    const renameCalls = findApiCalls(playlistState, 'PUT', '/playlists/1');
    expect(renameCalls.length).toBeGreaterThan(0);
    expect(renameCalls[0].body.name).toBe('Context Menu Renamed');
  });

  test('renamed playlist persists after page reload (mocked)', async ({ page }) => {
    const playlist1 = page.locator('[data-testid="sidebar-playlist-1"]');
    await playlist1.click({ button: 'right' });

    const renameOption = page.locator('[data-testid="playlist-rename"]');
    await renameOption.click();

    const renameInput = page.locator('[data-testid="playlist-rename-input"]');
    await renameInput.fill('Persistent Name');
    await renameInput.press('Enter');

    await page.waitForTimeout(300);

    const renameCalls = findApiCalls(playlistState, 'PUT', '/playlists/1');
    expect(renameCalls.length).toBeGreaterThan(0);

    playlistState.playlists[0].name = 'Persistent Name';

    await page.reload();
    await setupPlaylistMocks(page, playlistState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('aside[x-data="sidebar"]', { state: 'visible' });

    const renamedPlaylist = page.locator('[data-testid="sidebar-playlist-1"]');
    await expect(renamedPlaylist).toContainText('Persistent Name');
  });
});

test.describe('Sidebar Responsiveness', () => {
  test('should adjust sidebar width based on collapse state', async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);

    const sidebar = page.locator('aside[x-data="sidebar"]');

    // Expanded state
    await page.evaluate(() => {
      const sb = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sb.isCollapsed = false;
    });
    await page.waitForTimeout(300);

    const expandedWidth = (await sidebar.boundingBox()).width;

    // Collapsed state
    await page.evaluate(() => {
      const sb = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sb.isCollapsed = true;
    });
    await page.waitForTimeout(300);

    const collapsedWidth = (await sidebar.boundingBox()).width;

    expect(collapsedWidth).toBeLessThan(expandedWidth);
    expect(collapsedWidth).toBeLessThan(100); // Should be narrow when collapsed
  });
});

test.describe('Playlist Multi-Select and Batch Delete (task-161)', () => {
  let playlistState;

  test.beforeEach(async ({ page }) => {
    playlistState = createPlaylistState();
    await setupPlaylistMocks(page, playlistState);
    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForSelector('aside[x-data="sidebar"]', { state: 'visible' });
    await page.waitForSelector('[data-testid="sidebar-playlist-1"]', { state: 'visible' });
  });

  test('AC#1: Cmd/Ctrl-click toggles playlist selection without navigating', async ({ page }) => {
    const playlist1 = page.locator('[data-testid="sidebar-playlist-1"]');
    const playlist2 = page.locator('[data-testid="sidebar-playlist-2"]');

    await playlist1.click({ modifiers: ['Meta'] });
    await expect(playlist1).toHaveAttribute('data-selected', 'true');

    await playlist2.click({ modifiers: ['Meta'] });
    await expect(playlist1).toHaveAttribute('data-selected', 'true');
    await expect(playlist2).toHaveAttribute('data-selected', 'true');

    await playlist1.click({ modifiers: ['Meta'] });
    await expect(playlist1).toHaveAttribute('data-selected', 'false');
    await expect(playlist2).toHaveAttribute('data-selected', 'true');

    const activeSection = await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      return sidebar.activeSection;
    });
    expect(activeSection).not.toContain('playlist-');
  });

  test('AC#2: Shift-click selects contiguous range from anchor', async ({ page }) => {
    const playlist1 = page.locator('[data-testid="sidebar-playlist-1"]');
    const playlist2 = page.locator('[data-testid="sidebar-playlist-2"]');
    const playlist3 = page.locator('[data-testid="sidebar-playlist-3"]');

    await playlist1.click({ modifiers: ['Meta'] });
    await playlist3.click({ modifiers: ['Shift'] });

    await expect(playlist1).toHaveAttribute('data-selected', 'true');
    await expect(playlist2).toHaveAttribute('data-selected', 'true');
    await expect(playlist3).toHaveAttribute('data-selected', 'true');
  });

  test('AC#3: Selected playlists have distinct visual state', async ({ page }) => {
    const playlist1 = page.locator('[data-testid="sidebar-playlist-1"]');

    await playlist1.click({ modifiers: ['Meta'] });

    const classes = await playlist1.getAttribute('class');
    expect(classes).toContain('bg-[#DFDFDF]');
  });

  test('AC#4: Delete key while playlist list focused shows confirmation', async ({ page }) => {
    const playlistList = page.locator('[data-testid="playlist-list"]');
    const playlist1 = page.locator('[data-testid="sidebar-playlist-1"]');

    await playlist1.click({ modifiers: ['Meta'] });
    await playlistList.focus();

    page.once('dialog', async dialog => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('Delete playlist');
      await dialog.dismiss();
    });

    await page.keyboard.press('Delete');
  });

  test('AC#5: Backspace key also triggers confirmation', async ({ page }) => {
    const playlistList = page.locator('[data-testid="playlist-list"]');
    const playlist1 = page.locator('[data-testid="sidebar-playlist-1"]');

    await playlist1.click({ modifiers: ['Meta'] });
    await playlistList.focus();

    page.once('dialog', async dialog => {
      expect(dialog.type()).toBe('confirm');
      await dialog.dismiss();
    });

    await page.keyboard.press('Backspace');
  });

  test('AC#6: Confirmed deletion removes playlists via API and updates sidebar', async ({ page }) => {
    const playlistList = page.locator('[data-testid="playlist-list"]');
    const playlist1 = page.locator('[data-testid="sidebar-playlist-1"]');

    await playlist1.click({ modifiers: ['Meta'] });
    await playlistList.focus();

    page.once('dialog', async dialog => {
      await dialog.accept();
    });

    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);

    const deleteCalls = findApiCalls(playlistState, 'DELETE', '/playlists/1');
    expect(deleteCalls.length).toBeGreaterThan(0);
  });

  test('AC#7: Canceled deletion leaves playlists and selection unchanged', async ({ page }) => {
    const playlistList = page.locator('[data-testid="playlist-list"]');
    const playlist1 = page.locator('[data-testid="sidebar-playlist-1"]');

    await playlist1.click({ modifiers: ['Meta'] });
    await playlistList.focus();

    page.once('dialog', async dialog => {
      await dialog.dismiss();
    });

    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    await expect(playlist1).toBeVisible();
    await expect(playlist1).toHaveAttribute('data-selected', 'true');

    const deleteCalls = findApiCalls(playlistState, 'DELETE', '/playlists/');
    expect(deleteCalls.length).toBe(0);
  });

  test('AC#8: Delete/Backspace ignored while inline rename input is focused', async ({ page }) => {
    await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      sidebar.selectedPlaylistIds.push(1);
      sidebar.editingPlaylist = { id: 'playlist-1', playlistId: 1, name: 'Test Playlist 1' };
      sidebar.editingName = 'Test Playlist 1';
    });

    await page.waitForTimeout(300);

    const renameInput = page.locator('[data-testid="playlist-rename-input"]');
    await renameInput.focus();
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    const deleteCalls = findApiCalls(playlistState, 'DELETE', '/playlists/');
    expect(deleteCalls.length).toBe(0);
  });

  test('regular click clears selection and navigates', async ({ page }) => {
    const playlist1 = page.locator('[data-testid="sidebar-playlist-1"]');
    const playlist2 = page.locator('[data-testid="sidebar-playlist-2"]');

    await playlist1.click({ modifiers: ['Meta'] });
    await playlist2.click({ modifiers: ['Meta'] });
    await expect(playlist1).toHaveAttribute('data-selected', 'true');
    await expect(playlist2).toHaveAttribute('data-selected', 'true');

    await playlist1.click();
    await page.waitForTimeout(300);

    await expect(playlist1).toHaveAttribute('data-selected', 'false');
    await expect(playlist2).toHaveAttribute('data-selected', 'false');

    const activeSection = await page.evaluate(() => {
      const sidebar = window.Alpine.$data(document.querySelector('aside[x-data="sidebar"]'));
      return sidebar.activeSection;
    });
    expect(activeSection).toBe('playlist-1');
  });

  test('multi-select deletion lists selected playlists in confirmation message', async ({ page }) => {
    const playlistList = page.locator('[data-testid="playlist-list"]');
    const playlist1 = page.locator('[data-testid="sidebar-playlist-1"]');
    const playlist2 = page.locator('[data-testid="sidebar-playlist-2"]');

    await playlist1.click({ modifiers: ['Meta'] });
    await playlist2.click({ modifiers: ['Meta'] });
    await playlistList.focus();

    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Delete selected playlists');
      expect(dialog.message()).toContain('Test Playlist 1');
      expect(dialog.message()).toContain('Test Playlist 2');
      await dialog.dismiss();
    });

    await page.keyboard.press('Delete');
  });
});
