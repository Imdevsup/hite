/**
 * HITE — QA Playwright Config
 *
 * Four ANVIL pillars under one config:
 *   FORGE     — browser UI tests (smoke + responsive + a11y + visual + vitals)
 *   PROBE     — API contract / auth boundary / fuzz tests
 *   HAMMER    — light load (sustained + burst)
 *   SENTINEL  — continuous monitors (uptime + latency + SSL)
 *
 * Run:
 *   pnpm qa                      — all four pillars
 *   pnpm qa:forge                — FORGE only
 *   pnpm qa:probe                — PROBE only
 *   pnpm qa:hammer               — HAMMER only
 *   pnpm qa:sentinel             — SENTINEL only
 *   QA_BASE_URL=http://localhost:3000 pnpm qa
 */
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.QA_BASE_URL ?? "https://hite-app.vercel.app";

export default defineConfig({
  testDir: ".",
  globalSetup: "./helpers/wait-for-infra.ts",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: ".artifacts/report", open: "never" }],
    ["json", { outputFile: ".artifacts/report.json" }],
  ],
  outputDir: ".artifacts/test-results",
  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    colorScheme: "dark",
  },
  projects: [
    // ————————————————— FORGE — browser UI —————————————————
    {
      name: "forge-desktop",
      testDir: "./forge",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "forge-laptop",
      testDir: "./forge",
      testIgnore: ["**/visual/**", "**/performance/**"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },

    // ————————————————— PROBE — API contract —————————————————
    {
      name: "probe",
      testDir: "./probe",
      use: { ...devices["Desktop Chrome"] },
    },

    // ————————————————— HAMMER — light load —————————————————
    {
      name: "hammer",
      testDir: "./hammer",
      use: { ...devices["Desktop Chrome"] },
      retries: 0,
      fullyParallel: false,
      workers: 1,
    },

    // ————————————————— SENTINEL — monitors —————————————————
    {
      name: "sentinel",
      testDir: "./sentinel",
      use: { ...devices["Desktop Chrome"] },
      retries: 0,
    },
  ],
});
