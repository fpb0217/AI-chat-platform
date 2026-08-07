import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 6_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev:e2e",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        channel: "chrome",
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
