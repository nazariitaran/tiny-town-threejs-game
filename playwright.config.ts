import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT ?? 5188);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 20_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        // The default headless shell has no GPU and falls back to SwiftShader;
        // full Chromium renders headless on the real GPU.
        channel: 'chromium',
        viewport: { width: 1280, height: 720 },
      },
    },
    // Full phone support is not a priority right now, so the phone project is off.
    // {
    //   // Chromium rather than WebKit so multi-touch gestures can be driven through CDP
    //   // Input.dispatchTouchEvent. Real iOS Safari needs a device check.
    //   name: 'mobile-chrome',
    //   use: {
    //     ...devices['Pixel 7'],
    //     channel: 'chromium',
    //   },
    // },
  ],
});
