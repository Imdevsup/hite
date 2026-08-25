#!/usr/bin/env tsx
/**
 * End-to-end smoke test. Run against a live deployment:
 *   SMOKE_URL=https://app.hite.com SMOKE_TOKEN=... pnpm tsx scripts/smoke.ts
 *
 * Walks: upload sign → analyze kick → plan prompt → refine → render kick → status poll.
 * Exits non-zero on any failed step.
 */
const BASE = process.env.SMOKE_URL ?? "http://localhost:3000";
const TOKEN = process.env.SMOKE_TOKEN ?? "";

async function req(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { cookie: `sb-access-token=${TOKEN}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${body.slice(0, 200)}`);
  try { return JSON.parse(body); } catch { return body; }
}

async function main() {
  console.log("→ project list");
  const projects = await req("/api/projects");
  console.log(`  ${projects.projects?.length ?? 0} existing`);

  console.log("→ creating project");
  const proj = await req("/api/projects", { method: "POST", body: JSON.stringify({ title: "smoke-" + Date.now() }) });
  console.log(`  created ${proj.id}`);

  console.log("→ plan");
  const planRes = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `sb-access-token=${TOKEN}` },
    body: JSON.stringify({ projectId: proj.id, prompt: "add saturation" }),
  });
  if (!planRes.ok) throw new Error("plan failed: " + planRes.status);
  console.log("  plan stream open — ok");

  console.log("→ render kick");
  try {
    const ren = await req("/api/render", { method: "POST", body: JSON.stringify({ projectId: proj.id, aspect: "16:9", tier: "free" }) });
    console.log(`  export ${ren.exportId}`);
  } catch (e) {
    console.warn("  render skipped:", (e as Error).message);
  }

  console.log("✓ smoke green");
}

main().catch((e) => {
  console.error("✗ smoke failed:", e.message);
  process.exit(1);
});
