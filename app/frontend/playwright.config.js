import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for mt Tauri application E2E testing
 *
 * This configuration is designed for testing the Tauri + Alpine.js frontend
 * during the hybrid architecture phase (Python PEX sidecar backend).
 *
 * E2E_MODE environment variable controls test scope:
 *   - 'fast' (default): WebKit only, skip @tauri tests (fastest for macOS dev)
 *   - 'full': All browsers, skip @tauri tests
 *   - 'tauri': All browsers, include @tauri tests (for Tauri test harness)
 *
 * @see https://playwright.dev/docs/test-configuration
 */

const e2eMode = process.env.E2E_MODE || 'fast';
const includeTauri = e2eMode === 'tauri';
const webkitOnly = e2eMode === 'fast';

export default defineConfig({
  // Test directory (relative to app/frontend where this config lives)
  testDir: './tests',

  // Test file patterns
  testMatch: '**/*.spec.js',

  // Maximum time one test can run for
  timeout: 30000,

  // Run tests in files in parallel
  fullyParallel: true,

  // Optimize for CI performance
  workers: process.env.CI ? 4 : undefined,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Reduce retries since we have maxFailures now (1 retry instead of 2)
  retries: process.env.CI ? 1 : 0,

  // Stop after N test failures (fail-fast for CI)
  maxFailures: process.env.CI ? 5 : undefined,

  // Reporter to use
  reporter: [
    ['html', { outputFolder: '../../playwright-report' }],
    ['list'],
    // Add JUnit reporter for CI
    ...(process.env.CI ? [['junit', { outputFile: '../../test-results/junit.xml' }]] : [])
  ],

  // Shared settings for all the projects below
  use: {
    // Base URL for testing (Vite dev server)
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:5173',

    // Collect trace on failure (useful for debugging)
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Default viewport for desktop testing (minimum recommended size)
    viewport: { width: 1624, height: 1057 },

    // Emulate browser timezone
    timezoneId: 'America/Chicago',

    // Default timeout for actions (click, fill, etc.)
    actionTimeout: 8000,

    // Default timeout for navigation
    navigationTimeout: 20000,
  },

  // Skip @tauri tests by default (they require Tauri runtime, not browser)
  grepInvert: includeTauri ? undefined : /@tauri/,

  // Configure projects for major browsers
  // In 'fast' mode, only webkit runs (closest to macOS WKWebView)
  projects: webkitOnly
    ? [
        {
          name: 'webkit',
          use: {
            ...devices['Desktop Safari'],
            viewport: { width: 1624, height: 1057 },
          },
        },
      ]
    : [
        {
          name: 'chromium',
          use: {
            ...devices['Desktop Chrome'],
            viewport: { width: 1624, height: 1057 },
          },
        },
        {
          name: 'webkit',
          use: {
            ...devices['Desktop Safari'],
            viewport: { width: 1624, height: 1057 },
          },
        },
        {
          name: 'firefox',
          use: {
            ...devices['Desktop Firefox'],
            viewport: { width: 1624, height: 1057 },
          },
        },
      ],

  // Run dev server before starting tests
  // Note: When running from Taskfile, we're already in app/frontend
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI || !!process.env.ACT,
    timeout: 120000,
    stdout: 'ignore',
    stderr: 'pipe',
  },

  // Global setup/teardown
  // globalSetup: './tests/e2e/global-setup.js',
  // globalTeardown: './tests/e2e/global-teardown.js',
});
