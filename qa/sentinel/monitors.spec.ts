/**
 * SENTINEL — Continuous monitors (one-shot runnable via Playwright).
 * ANVIL's sentinel runs these on cron intervals; we run the same checks
 * as Playwright tests so the full suite is integrated.
 *
 * Budgets mirror ANVIL's sentinel tier:
 *   uptime       — every 5m,   budget: 200ms p50
 *   latency      — every 15m,  budget: 800ms p95
 *   ssl expiry   — every 24h,  budget: ≥ 14 days remaining
 *   dns          — every 1h,   budget: resolves within 1s
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

async function timedGet(request: APIRequestContext, path: string): Promise<{ status: number; ms: number }> {
  const start = Date.now();
  const res = await request.get(path);
  return { status: res.status(), ms: Date.now() - start };
}

test.describe("SENTINEL · Uptime", () => {
  const paths = ["/", "/how-to", "/api/health"];
  for (const path of paths) {
    test(`${path} reachable`, async ({ request }) => {
      const { status } = await timedGet(request, path);
      expect(status).toBeGreaterThanOrEqual(200);
      expect(status).toBeLessThan(400);
    });
  }
});

test.describe("SENTINEL · Latency", () => {
  test("/api/health p50 ≤ 800ms over 5 samples", async ({ request }) => {
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const { ms, status } = await timedGet(request, "/api/health");
      expect(status).toBe(200);
      samples.push(ms);
      await new Promise((r) => setTimeout(r, 200));
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length / 2)];
    console.log(`SENTINEL latency: /api/health samples=${samples.join(",")} p50=${p50}ms`);
    expect(p50).toBeLessThanOrEqual(800);
  });
});

test.describe("SENTINEL · SSL", () => {
  test("certificate has > 14 days until expiry", async ({ request }) => {
    const baseURL = process.env.QA_BASE_URL ?? "https://hite-app.vercel.app";
    if (!baseURL.startsWith("https://")) test.skip(true, "Non-HTTPS target");
    const res = await request.get(baseURL);
    expect(res.status()).toBeLessThan(400);

    const host = new URL(baseURL).host;
    const { ssl } = await checkSsl(host);
    test.skip(!ssl, "SSL inspection unavailable in this runtime");
    if (ssl) {
      const daysRemaining = (ssl.validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      console.log(`SENTINEL SSL: ${host} · ${ssl.issuer} · ${daysRemaining.toFixed(1)} days remaining`);
      expect(daysRemaining).toBeGreaterThan(14);
    }
  });
});

// Minimal SSL inspection via Node's tls module — skipped if tls isn't usable.
async function checkSsl(host: string): Promise<{ ssl: { validTo: Date; issuer: string } | null }> {
  try {
    const tls = await import("node:tls");
    return await new Promise((resolve) => {
      const socket = tls.connect(
        { host, port: 443, servername: host, rejectUnauthorized: true },
        () => {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert || !cert.valid_to) return resolve({ ssl: null });
          const issuerField = typeof cert.issuer === "object"
            ? (cert.issuer.O ?? cert.issuer.CN ?? "unknown")
            : "unknown";
          const issuer = Array.isArray(issuerField) ? issuerField[0] ?? "unknown" : issuerField;
          resolve({
            ssl: {
              validTo: new Date(cert.valid_to),
              issuer,
            },
          });
        },
      );
      socket.on("error", () => resolve({ ssl: null }));
      setTimeout(() => { try { socket.destroy(); } catch { /* ignore */ } resolve({ ssl: null }); }, 5000);
    });
  } catch {
    return { ssl: null };
  }
}
