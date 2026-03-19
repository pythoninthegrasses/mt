import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';
import { createLibraryState, setupLibraryMocks } from './fixtures/mock-library.js';

/**
 * Startup FOUC (Flash of Unstyled Content) Regression Tests (task-298)
 *
 * Verifies that the three-stage reveal mechanism prevents any unstyled
 * content from being visible during app startup:
 *   1. body[x-cloak] hides content via visibility: hidden
 *   2. Theme classes pre-applied to <html> before Alpine starts
 *   3. x-cloak removed only after Alpine.start() completes
 *
 * Related: task-250, task-256, commits 1b78d94c, e564b540, 2f35425d
 */
test.describe('Startup FOUC Prevention (task-298)', () => {
  test.describe('x-cloak CSS rules', () => {
    test('body[x-cloak] rule must exist in inline styles before any external CSS loads', async ({ page }) => {
      // Intercept the page before it loads to check inline styles
      let inlineStyleContent = '';

      await page.route('/', async (route) => {
        const response = await route.fetch();
        const html = await response.text();
        inlineStyleContent = html;
        await route.fulfill({ response });
      });

      const libraryState = createLibraryState();
      await setupLibraryMocks(page, libraryState);

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

      await page.goto('/');

      // Verify the inline <style> tag contains the critical x-cloak rules
      expect(inlineStyleContent).toContain('body[x-cloak]');
      expect(inlineStyleContent).toContain('visibility: hidden');

      // The x-cloak CSS must appear in a <style> tag in <head>, not in an
      // external stylesheet, so it applies before any network requests complete
      const styleTagPosition = inlineStyleContent.indexOf('<style>');
      const linkTagPosition = inlineStyleContent.indexOf('<link');

      // Inline style must exist
      expect(styleTagPosition).toBeGreaterThan(-1);

      // If there are <link> tags for external CSS, inline style must come first
      if (linkTagPosition > -1) {
        expect(styleTagPosition).toBeLessThan(linkTagPosition);
      }
    });

    test('body has x-cloak attribute in initial HTML', async ({ page }) => {
      const libraryState = createLibraryState();
      await setupLibraryMocks(page, libraryState);

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

      // Check body has x-cloak before JS runs by using addInitScript
      let hadCloakBeforeJS = false;
      await page.addInitScript(() => {
        // Store whether body has x-cloak at the earliest possible moment
        document.addEventListener('DOMContentLoaded', () => {
          window._testBodyHadCloak = document.body.hasAttribute('x-cloak');
        }, { once: true });
      });

      await page.goto('/');
      await waitForAlpine(page);

      hadCloakBeforeJS = await page.evaluate(() => window._testBodyHadCloak);
      expect(hadCloakBeforeJS).toBe(true);
    });

    test('inline styles include critical theme background colors for html element', async ({ page }) => {
      let inlineStyleContent = '';

      await page.route('/', async (route) => {
        const response = await route.fetch();
        inlineStyleContent = await response.text();
        await route.fulfill({ response });
      });

      const libraryState = createLibraryState();
      await setupLibraryMocks(page, libraryState);

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

      await page.goto('/');

      // Inline <style> must define background colors for all theme variants
      // to prevent white flash when window is shown early but body is hidden
      expect(inlineStyleContent).toContain('html {');
      expect(inlineStyleContent).toContain('html.dark {');
      expect(inlineStyleContent).toContain('html.dark[data-theme-preset="metro-teal"]');
      expect(inlineStyleContent).toContain('html.dark[data-theme-preset="neon-love"]');
    });

    test('body[x-cloak] computed visibility is hidden before Alpine initializes', async ({ page }) => {
      const libraryState = createLibraryState();
      await setupLibraryMocks(page, libraryState);

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

      // Capture computed visibility before Alpine starts
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
          const style = window.getComputedStyle(document.body);
          window._testBodyVisibilityBeforeAlpine = style.visibility;
          window._testBodyDisplayBeforeAlpine = style.display;
        }, { once: true });
      });

      await page.goto('/');
      await waitForAlpine(page);

      const visibility = await page.evaluate(() => window._testBodyVisibilityBeforeAlpine);
      const display = await page.evaluate(() => window._testBodyDisplayBeforeAlpine);

      // Body must be hidden (visibility: hidden) but not removed from layout (display: block)
      expect(visibility).toBe('hidden');
      expect(display).toBe('block');
    });
  });

  test.describe('x-cloak removal timing', () => {
    test.beforeEach(async ({ page }) => {
      const libraryState = createLibraryState();
      await setupLibraryMocks(page, libraryState);

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
    });

    test('x-cloak is removed after Alpine.start() completes', async ({ page }) => {
      // Track when x-cloak is removed relative to Alpine availability
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
              // Record whether Alpine was ready when x-cloak was removed
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

      // Wait for revealApp to have run (called after Alpine.start)
      await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'));

      const removedBeforeAlpine = await page.evaluate(() => window._testCloakRemovedBeforeAlpine);
      expect(removedBeforeAlpine).toBe(false);
    });

    test('x-cloak is not present after app is fully loaded', async ({ page }) => {
      await page.goto('/');
      await waitForAlpine(page);

      // Wait for reveal
      await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'));

      const hasCloak = await page.evaluate(() => document.body.hasAttribute('x-cloak'));
      expect(hasCloak).toBe(false);

      // Body should be visible
      const visibility = await page.evaluate(() =>
        window.getComputedStyle(document.body).visibility
      );
      expect(visibility).toBe('visible');
    });
  });

  test.describe('theme pre-application', () => {
    test.beforeEach(async ({ page }) => {
      const libraryState = createLibraryState();
      await setupLibraryMocks(page, libraryState);

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
    });

    test('html element has a theme class before x-cloak is removed', async ({ page }) => {
      // Track whether <html> has theme class at the moment x-cloak is removed
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
      // At reveal time, <html> must have either 'light' or 'dark' class
      const hasTheme = htmlClasses.includes('light') || htmlClasses.includes('dark');
      expect(hasTheme).toBe(true);
    });

    test('html element has inline background-color set before x-cloak is removed', async ({ page }) => {
      await page.addInitScript(() => {
        window._testHtmlBgColorAtReveal = null;

        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (
              mutation.type === 'attributes' &&
              mutation.attributeName === 'x-cloak' &&
              mutation.target === document.body &&
              !document.body.hasAttribute('x-cloak')
            ) {
              window._testHtmlBgColorAtReveal = document.documentElement.style.backgroundColor;
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

      const htmlBgColor = await page.evaluate(() => window._testHtmlBgColorAtReveal);
      // Must have an explicit inline background-color (not empty string)
      expect(htmlBgColor).toBeTruthy();
    });
  });

  test.describe('no visible unstyled content', () => {
    test.beforeEach(async ({ page }) => {
      const libraryState = createLibraryState();
      await setupLibraryMocks(page, libraryState);

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
    });

    test('all x-cloak elements are hidden before Alpine initializes', async ({ page }) => {
      // Check that general [x-cloak] rule hides all cloaked elements
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
          const cloaked = document.querySelectorAll('[x-cloak]');
          window._testCloakedElementsVisible = [];

          cloaked.forEach((el) => {
            const style = window.getComputedStyle(el);
            // body uses visibility:hidden, other elements use display:none
            const isVisible = el === document.body
              ? style.visibility !== 'hidden'
              : style.display !== 'none';

            if (isVisible) {
              window._testCloakedElementsVisible.push({
                tag: el.tagName,
                id: el.id,
                display: style.display,
                visibility: style.visibility,
              });
            }
          });
        }, { once: true });
      });

      await page.goto('/');
      await waitForAlpine(page);

      const visibleCloaked = await page.evaluate(() => window._testCloakedElementsVisible);
      expect(visibleCloaked).toEqual([]);
    });

    test('bg-background class produces a valid background color at reveal time', async ({ page }) => {
      // Ensure body has a real background color (not transparent/default white) when revealed
      await page.addInitScript(() => {
        window._testBgColorAtReveal = null;

        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (
              mutation.type === 'attributes' &&
              mutation.attributeName === 'x-cloak' &&
              mutation.target === document.body &&
              !document.body.hasAttribute('x-cloak')
            ) {
              window._testBgColorAtReveal = window.getComputedStyle(document.body).backgroundColor;
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

      const bgColor = await page.evaluate(() => window._testBgColorAtReveal);
      // Background must be a real color, not transparent or the browser default
      expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(bgColor).toBeTruthy();
    });
  });

  test.describe('Tauri window configuration', () => {
    test('tauri.conf.json has visible: false for startup window', async () => {
      // This is a static config check - read the Tauri config directly
      // (runs in Node.js context via Playwright)
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
});
