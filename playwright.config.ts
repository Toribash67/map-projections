import { defineConfig, devices } from '@playwright/test';

const PORT = 5183;

export default defineConfig({
  testDir: 'e2e',
  // A morph takes 1400 ms and several tests sit through one, on a machine that also runs the dev server.
  timeout: 60_000,
  workers: 2,
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT}`, viewport: { width: 1000, height: 600 } },
  webServer: { command: `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: true },
});
