import { defineConfig, devices } from '@playwright/test';

// E2E layout tests. These exist because the unit-test env (jsdom) does no
// layout, so CSS overflow/ellipsis bugs can only be caught in a real browser.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
    // Escape hatch for environments that can't reach the Playwright CDN: point
    // PW_CHROMIUM_PATH at a local chrome-headless-shell binary. Normally unset,
    // so `npx playwright install` provides the browser (e.g. in CI).
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
