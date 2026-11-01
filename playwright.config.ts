import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
// Lets a machine with a pre-installed Chromium of another revision run the suite.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/squatlens/`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
    },
  ],
  // The privacy proof runs against the production build (SPEC §8): `npm run build` first.
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/squatlens/`,
    reuseExistingServer: !process.env.CI,
  },
});
