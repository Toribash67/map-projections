import { defineConfig, devices } from '@playwright/test';

const PORT = 5183;

export default defineConfig({
  testDir: 'e2e',
  // A morph takes 1400 ms and several tests sit through one, on a machine that also runs the dev server.
  timeout: 60_000,
  workers: 2,
  // The sidebar is 300 px wide, so this leaves the map the 1000 x 600 that the render tests were written for.
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT}`, viewport: { width: 1300, height: 600 } },
  webServer: { command: `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: true },
});
