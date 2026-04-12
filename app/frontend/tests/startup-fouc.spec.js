import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

/**
 * Startup FOUC (Flash of Unstyled Content) Regression Tests (task-298)
 *
 * Reduced to 4 critical tests covering the three-stage reveal mechanism:
 *   1. body[x-cloak] hides content via visibility: hidden
 *   2. Theme classes pre-applied to <html> before Alpine starts
 *   3. x-cloak removed only after Alpine.start() completes
 *   4. Tauri window starts hidden (static config check)
 */

async function setupLastfmMock(page) {
  await page.route(/\/api\/lastfm\/settings/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: false,
        username: null,
        authenticated: false,
        configured: false,
        scrobble_threshold: 50,
      }),
    });
  });
}

test.describe('Startup FOUC Prevention (task-298)', () => {
  test('body[x-cloak] rule must exist in inline styles before any external CSS loads', async ({ page }) => {
    let inlineStyleContent = '';

    await page.route('/', async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      inlineStyleContent = html;
      await route.fulfill({ response });
    });

    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await setupLastfmMock(page);

    await page.goto('/');

    // Verify the inline <style> tag contains the critical x-cloak rules
    expect(inlineStyleContent).toContain('body[x-cloak]');
    expect(inlineStyleContent).toContain('visibility: hidden');

    // Inline style must appear before any external <link> tag
    const styleTagPosition = inlineStyleContent.indexOf('<style>');
    const linkTagPosition = inlineStyleContent.indexOf('<link');

    expect(styleTagPosition).toBeGreaterThan(-1);
    if (linkTagPosition > -1) {
      expect(styleTagPosition).toBeLessThan(linkTagPosition);
    }

    // Must also define theme background colors for all variants
    expect(inlineStyleContent).toContain('html {');
    expect(inlineStyleContent).toContain('html.dark {');
  });

  test('x-cloak is removed only after Alpine.start() completes', async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await setupLastfmMock(page);

    await page.addInitScript(() => {
      window._testCloakRemovedBeforeAlpine = null;

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (
            mutation.type === 'attributes' &&
            mutation.attributeName === 'x-cloak' &&
            mutation.target === document.body &&
            !document.body.hasAttribute('x-cloak')
          ) {
            window._testCloakRemovedBeforeAlpine = !(window.Alpine && window.Alpine.store);
            observer.disconnect();
          }
        }
      });

      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { attributes: true });
      }, { once: true });
    });

    await page.goto('/');
    await waitForAlpine(page);

    await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'));

    const removedBeforeAlpine = await page.evaluate(() => window._testCloakRemovedBeforeAlpine);
    expect(removedBeforeAlpine).toBe(false);
  });

  test('html element has theme class before x-cloak is removed', async ({ page }) => {
    const libraryState = createLibraryState();
    await setupLibraryMocks(page, libraryState);
    await setupLastfmMock(page);

    await page.addInitScript(() => {
      window._testHtmlClassesAtReveal = null;

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (
            mutation.type === 'attributes' &&
            mutation.attributeName === 'x-cloak' &&
            mutation.target === document.body &&
            !document.body.hasAttribute('x-cloak')
          ) {
            window._testHtmlClassesAtReveal = document.documentElement.className;
            observer.disconnect();
          }
        }
      });

      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { attributes: true });
      }, { once: true });
    });

    await page.goto('/');
    await waitForAlpine(page);
    await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'));

    const htmlClasses = await page.evaluate(() => window._testHtmlClassesAtReveal);
    const hasTheme = htmlClasses.includes('light') || htmlClasses.includes('dark');
    expect(hasTheme).toBe(true);
  });

  test('tauri.conf.json has visible: false for startup window', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const configPath = path.resolve(
      import.meta.dirname,
      '../../../crates/mt-tauri/tauri.conf.json',
    );
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    const mainWindow = config.app.windows[0];
    expect(mainWindow.visible).toBe(false);
  });
});
