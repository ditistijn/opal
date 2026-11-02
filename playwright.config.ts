import { defineConfig, devices } from "@playwright/test"

/**
 * Browser-mode smoke tests (no Tauri, no OpenCode): the app runs on the in-memory mock runtime
 * (`VITE_OPAL_MOCK=1`). Run with `pnpm test:e2e`. Screenshots land in test-results/screenshots/.
 *
 * A dedicated port (default 1430) keeps this from colliding with a `pnpm dev`/`pnpm app:dev`
 * session on 1420. Override with E2E_PORT.
 */
const PORT = Number(process.env.E2E_PORT ?? 1430)
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 820 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 820 } } },
  ],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    env: { VITE_OPAL_MOCK: "1" },
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
})
