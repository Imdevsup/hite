import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: process.env.SMOKE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
});
