# HITE — QA Suite (ANVIL pillars)

Full QA pipeline adapted from **Altab's ANVIL** (Altab Networked Verification & Integration Layer). Four pillars, one config, one runner.

```
qa/
├── playwright.config.ts       — Single config, five Playwright "projects", one per pillar variant
├── helpers/
│   ├── guest-auth.ts          — Enters /app (middleware mints the anonymous session) + kills the tutorial
│   ├── react-input.ts         — Fires React's synthetic onChange correctly
│   ├── selectors.ts           — Centralised selectors, no magic strings
│   └── wait-for-infra.ts      — globalSetup: polls /api/health until target is reachable
│
├── forge/                     — 🔨 Browser UI verification
│   ├── smoke/                 — landing · middleware · health · editor · chat · accessibility
│   ├── responsive/            — 375 / 768 / 1440 / 1920 viewport matrix
│   ├── accessibility/         — @axe-core WCAG 2.1 AA (critical + serious fail; contrast soft-warn)
│   ├── visual/                — Screenshot regression (landing hero)
│   └── performance/           — Web Vitals budgets: LCP ≤ 3s, CLS ≤ 0.1, TTFB ≤ 800ms
│
├── probe/                     — 🔎 API contract verification
│   ├── auth-boundary.spec.ts  — Every protected endpoint returns 401 without session
│   ├── schema.spec.ts         — /api/health & /api/errors contract validation
│   └── fuzz.spec.ts           — Adversarial payloads → 4xx, never 5xx (9 endpoints × 14 payloads)
│
├── hammer/                    — 🔨 Light load generation
│   ├── sustained.spec.ts      — 10 conc × 6 bursts, p95 ≤ 1.5s, no 5xx
│   └── burst.spec.ts          — 50 simultaneous, p95 ≤ 2s, no resets
│
└── sentinel/                  — 📡 Continuous monitors (runnable on cron)
    └── monitors.spec.ts       — Uptime · latency p50 ≤ 800ms · SSL expiry > 14d
```

## Running

```bash
# Everything, production target
pnpm qa

# One pillar at a time
pnpm qa:forge           # UI (smoke + responsive + a11y + visual + vitals)
pnpm qa:probe           # API contract + fuzz
pnpm qa:hammer          # Load burst + sustained
pnpm qa:sentinel        # Uptime + SSL + latency monitors

# Against local dev
QA_BASE_URL=http://localhost:3000 pnpm qa

# Filter within a pillar
pnpm qa:forge --grep "Accessibility"
pnpm qa:probe --grep "auth-boundary"

# UI mode (visible browser)
pnpm qa:ui

# Snapshot management
pnpm qa:forge --update-snapshots     # regenerate visual baselines
```

## Authenticated tests

There is no sign-in screen and no guest button. `middleware.ts` mints a Supabase **anonymous** session on the first request to `/app`, so editor + chat specs just navigate there — `enterAsGuest(page)` is now a navigation plus tutorial suppression.

That requires anonymous sign-ins to be enabled on the target project, which is the app's hard requirement, not a test-only one: with it off, `/app` answers **503** for everyone. Locally it is `enable_anonymous_sign_ins = true` in `supabase/config.toml` (already set) followed by a `supabase stop && supabase start`; on a hosted project it is Dashboard → Authentication → Sign In / Providers → Anonymous. `enterAsGuest` reports the 503 body as its skip reason.

## Artifacts

All outputs land in `qa/.artifacts/` (gitignored):

- `report/index.html` — combined HTML report (`pnpm exec playwright show-report qa/.artifacts/report`)
- `report.json` — machine-readable summary for CI ingestion
- `test-results/*/trace.zip` — per-failure traces (`pnpm exec playwright show-trace …`)
- `test-results/*/screenshot.png` · `video.webm`

## Mapping to ANVIL

| ANVIL pillar | HITE equivalent | Notes |
|---|---|---|
| **FORGE** — Playwright UI + visual + a11y + vitals | `qa/forge/` | 1:1 port, viewport matrix scaled to HIG |
| **PROBE** — schema discovery, fuzzer, auth tester, rate-limit tester | `qa/probe/` | Schema swapped for HITE's REST; auth-boundary covers every protected route |
| **HAMMER** — sustained/burst/chaos load | `qa/hammer/` | Scaled down ~50× to be safe for prod; knobs via `QA_HAMMER_*` env |
| **SENTINEL** — uptime/latency/SSL/DNS monitors | `qa/sentinel/` | Single spec; cron from CI or an always-on runner |
| **Reporting** — SQLite + HTML dashboard | Playwright's built-in HTML + JSON reporters | Same outputs, one fewer moving part |

## Adding new tests

- Pick the right pillar folder — don't bolt API tests into forge.
- Use `helpers/selectors.ts` — no magic strings inline.
- For authed flows, call `enterAsGuest(page)` and guard `test.skip(!result.ok, result.reason)`.
- For React controlled inputs, use `fillReactInput()` — plain `.fill()` skips React's value tracker.
- Hammer/probe tests must be safe against prod — no destructive writes, no auth escalation.
