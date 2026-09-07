import { defineConfig, devices } from "@playwright/test";

/**
 * Exercises Vite's optimized output, including its generated lazy JavaScript and
 * CSS chunks. This catches packaging regressions that the development server can
 * hide and mirrors the frontend files embedded in the Tauri application.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "cold-workspace-styles.spec.ts",
    "cold-stagehand-shared-midi.spec.ts",
    "production-chunk-styles.spec.ts",
    "route-order-styles.spec.ts",
  ],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:1421",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium-production", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.platform === "win32"
      ? "npm.cmd run preview -- --host 127.0.0.1 --port 1421"
      : "npm run preview -- --host 127.0.0.1 --port 1421",
    url: "http://127.0.0.1:1421",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
