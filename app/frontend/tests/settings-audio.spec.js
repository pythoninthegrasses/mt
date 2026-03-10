import { expect, test } from '@playwright/test';
import { waitForAlpine } from './fixtures/helpers.js';

test.describe('Audio Settings UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.waitForSelector('[data-testid="settings-nav-audio"]', {
      state: 'visible',
    });
  });

  test('should display Audio nav item in settings sidebar', async ({ page }) => {
    const audioNav = page.locator('[data-testid="settings-nav-audio"]');
    await expect(audioNav).toBeVisible();
    await expect(audioNav).toHaveText('Audio');
  });

  test('should navigate to Audio section when clicked', async ({ page }) => {
    await page.click('[data-testid="settings-nav-audio"]');
    const audioSection = page.locator(
      '[data-testid="settings-section-audio"]',
    );
    await expect(audioSection).toBeVisible();
  });

  test('should display device selector with Default option', async ({ page }) => {
    await page.click('[data-testid="settings-nav-audio"]');

    const select = page.locator('[data-testid="audio-device-select"]');
    await expect(select).toBeVisible();

    const defaultOption = select.locator('option[value="default"]');
    await expect(defaultOption).toHaveText('Default');
  });
});

test.describe('Audio Settings with Mocked Tauri', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const mockDevices = ['Built-in Output', 'External DAC'];
      let selectedDevice = 'default';
      window.__tauriInvocations = [];

      window.__TAURI__ = {
        core: {
          invoke: (cmd, args) => {
            window.__tauriInvocations.push({ cmd, args });
            if (cmd === 'audio_list_devices') {
              return Promise.resolve({ devices: mockDevices });
            }
            if (cmd === 'audio_set_device') {
              selectedDevice = args?.deviceName || 'default';
              return Promise.resolve(null);
            }
            if (cmd === 'app_get_info') {
              return Promise.resolve({ version: 'test', build: 'test', platform: 'test' });
            }
            if (cmd === 'watched_folders_list') {
              return Promise.resolve([]);
            }
            if (cmd === 'lastfm_get_settings') {
              return Promise.resolve({
                enabled: false,
                authenticated: false,
                scrobble_threshold: 90,
              });
            }
            if (cmd === 'settings_get') {
              if (args?.key === 'audio_output_device') {
                return Promise.resolve({ key: 'audio_output_device', value: selectedDevice });
              }
              return Promise.resolve({ key: args?.key, value: null });
            }
            if (cmd === 'settings_set') {
              return Promise.resolve({ key: args?.key, value: args?.value });
            }
            return Promise.resolve(null);
          },
        },
        event: {
          listen: () => Promise.resolve(() => {}),
        },
        dialog: {
          confirm: () => Promise.resolve(true),
        },
      };
    });

    await page.goto('/');
    await waitForAlpine(page);

    await page.click('[data-testid="sidebar-settings"]');
    await page.waitForSelector('[data-testid="settings-nav-audio"]', {
      state: 'visible',
    });
    await page.click('[data-testid="settings-nav-audio"]');
  });

  test('should list mocked audio devices in dropdown', async ({ page }) => {
    const select = page.locator('[data-testid="audio-device-select"]');
    await expect(select).toBeVisible();

    const options = select.locator('option');
    // Default + 2 mocked devices = 3 options
    await expect(options).toHaveCount(3);

    await expect(options.nth(0)).toHaveText('Default');
    await expect(options.nth(1)).toHaveText('Built-in Output');
    await expect(options.nth(2)).toHaveText('External DAC');
  });

  test('should call audio_set_device when device is selected', async ({ page }) => {
    // Clear prior invocations from init
    await page.evaluate(() => {
      window.__tauriInvocations = [];
    });

    const select = page.locator('[data-testid="audio-device-select"]');
    await select.selectOption('External DAC');

    await page.waitForFunction(
      () =>
        window.__tauriInvocations.some(
          (inv) => inv.cmd === 'audio_set_device',
        ),
      { timeout: 5000 },
    );

    const setDeviceCall = await page.evaluate(() =>
      window.__tauriInvocations.find((inv) => inv.cmd === 'audio_set_device')
    );
    expect(setDeviceCall).toBeDefined();
    expect(setDeviceCall.args.deviceName).toBe('External DAC');
  });

  test('should send null deviceName when Default is selected', async ({ page }) => {
    // First select a non-default device
    const select = page.locator('[data-testid="audio-device-select"]');
    await select.selectOption('Built-in Output');

    // Clear invocations and select default
    await page.evaluate(() => {
      window.__tauriInvocations = [];
    });

    await select.selectOption('default');

    await page.waitForFunction(
      () =>
        window.__tauriInvocations.some(
          (inv) => inv.cmd === 'audio_set_device',
        ),
      { timeout: 5000 },
    );

    const setDeviceCall = await page.evaluate(() =>
      window.__tauriInvocations.find((inv) => inv.cmd === 'audio_set_device')
    );
    expect(setDeviceCall).toBeDefined();
    expect(setDeviceCall.args.deviceName).toBeNull();
  });
});
