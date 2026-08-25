/**
 * Playwright globalSetup — polls the target's /api/health until it responds.
 * Adapted from Altab's ANVIL helper; here we target a single HTTP endpoint.
 */
import type { FullConfig } from "@playwright/test";

const MAX_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 750;

async function pollUntilReady(url: string, label: string): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`${label} not ready after ${MAX_WAIT_MS}ms. Last error: ${lastError}`);
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects[0]?.use?.baseURL ??
    process.env.QA_BASE_URL ??
    "https://hite-app.vercel.app";

  const healthUrl = `${baseURL.replace(/\/$/, "")}/api/health`;

  console.log(`[QA globalSetup] Waiting for ${healthUrl}...`);
  await pollUntilReady(healthUrl, "HITE /api/health");
  console.log("[QA globalSetup] Target is reachable.");
}
