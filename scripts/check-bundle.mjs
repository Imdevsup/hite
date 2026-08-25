// scripts/check-bundle.mjs — the landing bundle's named CI owner.
//
// DESIGN-DIRECTION §12 asked for "a CI step that fails the build on regression … Without a CI owner
// this is a wish", and named ≤140KB gzipped. ART-DIRECTION §16 kept the owner and replaced the
// number with "measured baseline + ≤ 12 KB gz", because an absolute ceiling a framework floor has
// already spent is waived on the first build. See the note on HEADROOM_BYTES.
//
// WHAT IT MEASURES, AND WHY FROM THE HTML. The landing prerenders, so `next build` leaves the exact
// document the CDN serves at `.next/server/app/index.html`. Every `<script src>` in it is a file the
// browser must download to make `/` interactive — the shared App Router runtime, the layout chunk,
// the page chunk and their shared vendor splits. Reading that document is the only measurement that
// cannot drift from what ships: it is version-independent (Next 16 no longer emits
// `app-build-manifest.json`), it needs no second bundler building a second graph, and it counts a
// chunk shared by two entries exactly once, the way a browser does.
//
// `nomodule` scripts are excluded. They are the legacy-browser polyfill bundle, which every engine
// that can run this page skips; charging the budget for bytes no supported browser downloads would
// make the number pessimistic rather than honest. The exclusion is reported, not silent.
//
// It needs a completed build and says so plainly rather than passing on a missing directory — a
// budget gate that silently succeeds when it cannot measure is worse than no gate.
//
// WHY THERE IS A `--why` MODE. A number without a cause is a number nobody can act on. Told only
// "188.5KB, over by 48.5KB", the reasonable next move is to start deleting features — and on this
// page that would have been exactly wrong: the landing's OWN code was 12.9KB of the 188.5KB, and
// 45KB was one library the landing never imports, pulled in by two files that have nothing to do
// with it (`app/providers.tsx`'s root-layout `<MotionConfig>`, and `components/editor/KiteMark.tsx`
// via the `app/error.tsx` / `app/not-found.tsx` boundaries). `--why` reads the chunks' source maps
// and prints the per-module breakdown that says so, so the next person over budget spends their
// effort on the right file. It needs maps, which `next.config.ts` emits only under
// HITE_BUNDLE_ANALYZE=1; without them it degrades to the per-chunk table and says why.
//
// Usage:  pnpm build && pnpm check:bundle
//         HITE_BUNDLE_ANALYZE=1 NEXT_DIST_DIR=.next-analyze npx next build --webpack
//         HITE_VERIFY_DIST=.next-analyze node scripts/check-bundle.mjs --why
// Honors HITE_VERIFY_DIST, so it also reads a `pnpm build:verify` throwaway distDir.

import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

/**
 * THE BUDGET IS INCREMENTAL, BECAUSE AN ABSOLUTE ONE HERE IS UNENFORCEABLE.
 *
 * This gate used to hold `140 * 1024`, from DESIGN-DIRECTION §12. `ART-DIRECTION.md` §16 replaced
 * that line and said why: "The old draft's '≤140 KB gz' was consumed by the framework before a line
 * of animation code — a Next 16 App Router landing's baseline first-load JS is typically 90–110 KB
 * gz … A budget that is spent on arrival gets waived on the first build. **Incremental over a
 * written-down measured baseline is the only enforceable form.**" Its budgets table names the number
 * exactly: "measured baseline + ≤ 12 KB gz", enforced by this script, with "write today's number
 * into the config on the first run."
 *
 * That is what happens below. The baseline lives in `scripts/bundle-baseline.json`, next to this
 * file, and is written on the first run against a build. It is data, not a target: raising it is a
 * deliberate, reviewable, one-line diff that says "this page got bigger and we accepted it", which
 * is precisely the conversation an absolute ceiling at 96% consumption cannot force.
 */
const HEADROOM_BYTES = 12 * 1024;
const BASELINE_FILE = fileURLToPath(new URL("./bundle-baseline.json", import.meta.url));
const BASELINE_LABEL = relative(process.cwd(), BASELINE_FILE);

/** Where `next build` writes the prerendered landing document, and the prefix its scripts carry. */
const LANDING_HTML = join("server", "app", "index.html");
const ASSET_PREFIX = "/_next/";

const ROOT = process.cwd();
const DIST = join(ROOT, process.env.HITE_VERIFY_DIST ?? ".next");
const WHY = process.argv.includes("--why");

function fail(message) {
  console.error(`[bundle] ${message}`);
  process.exit(1);
}

function read(relPath, encoding) {
  const abs = join(DIST, relPath);
  try {
    return readFileSync(abs, encoding);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      fail(
        `no build output at ${relative(ROOT, abs)}. This gate measures what the deploy ships, so it ` +
          `needs a completed build first: \`pnpm build\` (or \`pnpm build:verify\`), then \`pnpm check:bundle\`. ` +
          `If the build DID run, the landing stopped prerendering — that is itself a §9.7 regression.`,
      );
    }
    fail(`could not read ${relative(ROOT, abs)}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const html = read(LANDING_HTML, "utf8");

const tags = [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)>/g)].map((m) => ({
  attrs: `${m[1]} ${m[3]}`,
  src: m[2],
}));

const legacy = tags.filter((t) => /\bnomodule\b/i.test(t.attrs)).map((t) => t.src);
const files = [
  ...new Set(
    tags
      .filter((t) => !/\bnomodule\b/i.test(t.attrs))
      .map((t) => t.src)
      .filter((src) => src.startsWith(ASSET_PREFIX))
      .map((src) => src.slice(ASSET_PREFIX.length)),
  ),
];

if (files.length === 0) {
  fail(
    `found no client scripts in ${LANDING_HTML}. Either the landing ships zero JS (celebrate, then ` +
      `update this gate) or the parse is wrong — refusing to report a pass either way.`,
  );
}

let total = 0;
const rows = [];
for (const file of files) {
  const gz = gzipSync(read(file), { level: 9 }).byteLength;
  total += gz;
  rows.push({ file, gz });
}

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;

rows.sort((a, b) => b.gz - a.gz);
for (const { file, gz } of rows) console.log(`  ${kb(gz).padStart(8)}  ${file}`);
if (legacy.length > 0) console.log(`  (excluded, nomodule: ${legacy.join(", ")})`);

/**
 * Read the written baseline, or write today's number as it (§16: "Write today's number into the
 * config on the first run"). A malformed file is a hard failure rather than a silent re-baseline:
 * quietly adopting the current size is exactly how an incremental gate stops gating.
 */
function readBaseline() {
  if (!existsSync(BASELINE_FILE)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  } catch (err) {
    fail(`${BASELINE_LABEL} is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  const bytes = parsed?.landingClientJsGzBytes;
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    fail(
      `${BASELINE_LABEL} has no usable "landingClientJsGzBytes". Delete the ` +
        `file to re-baseline deliberately; this gate will not guess a budget.`,
    );
  }
  return { bytes, measuredAt: typeof parsed.measuredAt === "string" ? parsed.measuredAt : "unknown" };
}

const baseline = readBaseline();
if (baseline === null) {
  writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify(
      {
        note:
          "ART-DIRECTION §16: landing client JS is budgeted as this measured baseline + 12KB gz. " +
          "Raising this number is a deliberate, reviewable decision — never a fix for a failing gate.",
        landingClientJsGzBytes: total,
        measuredAt: new Date().toISOString().slice(0, 10),
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `[bundle] landing client JS: ${files.length} chunks, ${kb(total)} gzipped — no baseline on ` +
      `disk, so §16's "write today's number into the config on the first run" just ran. Wrote ` +
      `${BASELINE_LABEL}.`,
  );
} else {
  const ceiling = baseline.bytes + HEADROOM_BYTES;
  const delta = total - baseline.bytes;
  const sign = delta >= 0 ? "+" : "-";
  console.log(
    `[bundle] landing client JS: ${files.length} chunks, ${kb(total)} gzipped — ${sign}${kb(Math.abs(delta))} ` +
      `against the ${kb(baseline.bytes)} baseline of ${baseline.measuredAt}, ceiling ${kb(ceiling)} ` +
      `(§16: baseline + ${kb(HEADROOM_BYTES)}).`,
  );
}

/**
 * THE DOCUMENT, REPORTED BUT NOT BUDGETED — the number that catches this gate being gamed.
 *
 * §16 budgets client JS, and the cheapest way to make that number fall is to convert client
 * components into Server Components. That is usually the right move (JS costs download + parse +
 * compile + execute on the main thread; a document costs download), but it is not free and it is not
 * invisible: an App Router page carries the RSC flight payload for its server tree INSIDE this
 * document, so markup that leaves the JS chunk reappears here. Measured on the 2026-08-19 chrome
 * split: client JS fell 5.2KB and this document rose 5.9KB gzipped — a real INP/hydration win, and
 * very nearly a wash on total bytes over the wire.
 *
 * So it is printed on every run. A future change that drops client JS while this number climbs by
 * more has not made the page faster, and the person reading this output should be able to see that
 * without being told. It does not fail the build, because §16 sets no budget for it.
 */
const docBytes = Buffer.byteLength(html);
const docGz = gzipSync(Buffer.from(html), { level: 9 }).byteLength;
console.log(
  `[bundle] landing document: ${kb(docGz)} gzipped (${kb(docBytes)} raw) — markup + the RSC flight ` +
    `payload. Not budgeted by §16; reported so a JS→payload shuffle cannot read as a win.`,
);

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   `--why` — WHICH MODULE OWNS WHICH BYTE.

   Walks each chunk's source map and charges every generated segment the bytes between its start
   column and the next segment's, then collapses the source paths to the package or repo file that
   owns them. Gzip is not additive across modules, so a module's share of the chunk's REAL gzipped
   size is reported pro-rata by raw bytes — an estimate, and labelled one. The per-chunk gzip totals
   above are exact; only the split inside a chunk is apportioned.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Largest run of generated bytes a single mapping may be charged for, before the excess is booked as
 * unmapped instead.
 *
 * WHY THIS IS NEEDED, AND WHY THE NUMBER IS 2048. Webpack emits NO mappings for asset modules — a
 * `import raw from "…/mechanism.display.json"` becomes a `JSON.parse('{…}')` module that appears
 * nowhere in `map.sources`. Charging each mapping "up to the next one" therefore dumps that whole
 * unmapped blob onto whichever module happens to precede it, and the tool then names an innocent
 * file with total confidence. Measured on this build: across 14,012 mappings in the two chunks that
 * carry first-party code, the largest genuine charge is 395 bytes and there is exactly one outlier —
 * 20,329 bytes, the landing fixture JSON, charged to the 95-line file next to it. 2048 is five times
 * the largest real run and a tenth of the blob, so it separates them without tuning. The excess is
 * reported, never silently dropped.
 */
const MAX_SEGMENT_BYTES = 2048;

/** Decode one comma-separated Base64-VLQ segment into its signed fields. */
function decodeVlq(segment) {
  const fields = [];
  let shift = 0;
  let value = 0;
  for (const ch of segment) {
    const digit = B64.indexOf(ch);
    if (digit === -1) return null; // malformed map — caller degrades rather than throws
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    const negative = value & 1;
    value >>= 1;
    fields.push(negative ? -value : value);
    value = 0;
    shift = 0;
  }
  return fields;
}

/** Collapse a webpack source URL to the npm package or repo-relative file that owns it. */
function owner(source) {
  const path = source.replace(/^webpack:\/\/_N_E\//, "").replace(/^webpack:\/\//, "");
  const at = path.lastIndexOf("node_modules/");
  if (at === -1) return path.replace(/^\(app-pages-browser\)\//, "");
  const rest = path.slice(at + "node_modules/".length);
  const parts = rest.split("/");
  const pkg = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  // `next` is most of the framework floor; naming its subsystem is the difference between
  // "next, 60KB" (unactionable) and "next/dist/client/components/segment-cache" (a real answer).
  return pkg === "next" ? `next/${parts.slice(1, 4).join("/")}` : pkg;
}

function explain(chunkRows, grandTotal) {
  const totals = new Map();
  let unmapped = 0;

  for (const { file, gz } of chunkRows) {
    const mapPath = join(DIST, `${file}.map`);
    if (!existsSync(mapPath)) {
      unmapped += gz;
      continue;
    }
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    const lines = read(file, "utf8").split("\n");
    const perOwner = new Map();
    let charged = 0;
    let sourceIndex = 0;
    /** Bytes inside this chunk that no mapping may claim — asset modules, mostly inlined JSON. */
    let unmappedInChunk = 0;

    map.mappings.split(";").forEach((lineMappings, lineNo) => {
      if (!lineMappings) return;
      const lineLength = (lines[lineNo] ?? "").length;
      const segments = [];
      let column = 0;
      for (const raw of lineMappings.split(",")) {
        if (!raw) continue;
        const fields = decodeVlq(raw);
        if (!fields) return;
        column += fields[0];
        if (fields.length >= 4) sourceIndex += fields[1];
        segments.push({ column, source: fields.length >= 4 ? sourceIndex : null });
      }
      for (let i = 0; i < segments.length; i++) {
        if (segments[i].source === null) continue;
        const end = i + 1 < segments.length ? segments[i + 1].column : lineLength;
        const span = Math.max(0, end - segments[i].column);
        const bytes = Math.min(span, MAX_SEGMENT_BYTES);
        unmappedInChunk += span - bytes;
        const name = owner(map.sources[segments[i].source] ?? "(unknown)");
        perOwner.set(name, (perOwner.get(name) ?? 0) + bytes);
        charged += bytes;
      }
    });

    const accounted = charged + unmappedInChunk;
    if (accounted === 0) {
      unmapped += gz;
      continue;
    }
    for (const [name, bytes] of perOwner) {
      totals.set(name, (totals.get(name) ?? 0) + (bytes / accounted) * gz);
    }
    unmapped += (unmappedInChunk / accounted) * gz;
  }

  if (totals.size === 0) {
    console.log(
      `[bundle] --why needs source maps, and this build has none. Rebuild with ` +
        `HITE_BUNDLE_ANALYZE=1 (see next.config.ts) and point HITE_VERIFY_DIST at that output.`,
    );
    return;
  }

  console.log(`\n[bundle] --why · per-module share of ${kb(grandTotal)} (gzip apportioned by raw bytes):`);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  let shown = 0;
  for (const [name, gz] of ranked) {
    if (gz < 512) break;
    console.log(`  ${kb(gz).padStart(8)}  ${name}`);
    shown += gz;
  }
  const rest = grandTotal - shown - unmapped;
  if (rest > 512) console.log(`  ${kb(rest).padStart(8)}  (everything under 0.5KB)`);
  if (unmapped > 512) {
    console.log(
      `  ${kb(unmapped).padStart(8)}  (unmapped — asset modules webpack does not map, e.g. inlined JSON)`,
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   PROVIDER SDKs MUST NOT REACH THE BROWSER.

   HITE offers eight AI providers, ~1.13 MiB of ESM between them. None of it belongs in a client
   chunk: the planner runs in a Node route handler, and `lib/ai/providers/registry.ts` is written to
   import no provider package precisely so the settings UI can render every provider, model, help
   link and verification badge from plain data.

   `registry.test.ts` guards that at the SOURCE level, which catches the mistake at `pnpm test`. This
   catches the other half — a client component importing `factory.ts` (or any provider package)
   transitively, which no source-level rule can see. It measures what actually shipped.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

const PROVIDER_PACKAGES = [
  "@ai-sdk/google",
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
  "@ai-sdk/groq",
  "@ai-sdk/xai",
  "@ai-sdk/deepseek",
  "@ai-sdk/openai-compatible",
  "@openrouter/ai-sdk-provider",
];

/** Distinctive strings from each provider's own wire code — a package NAME may survive only as a
 *  harmless comment, but these appear because the module was actually bundled. */
const PROVIDER_MARKERS = [
  "generativelanguage.googleapis.com",
  "https://api.openai.com/v1",
  "https://api.anthropic.com/v1",
  "https://api.groq.com/openai/v1",
  "https://api.x.ai/v1",
  "https://api.deepseek.com",
  "https://openrouter.ai/api/v1",
];

const providerHits = [];
for (const file of files) {
  const text = read(file, "utf8");
  for (const marker of [...PROVIDER_PACKAGES, ...PROVIDER_MARKERS]) {
    if (text.includes(marker)) providerHits.push(`${file} → ${marker}`);
  }
}
if (providerHits.length > 0) {
  fail(
    `an AI provider SDK reached a CLIENT chunk:\n  ${providerHits.join("\n  ")}\n` +
      `The provider packages are server-only (lib/ai/providers/factory.ts). Something in the client ` +
      `tree imports one — usually a client component reaching past lib/ai/providers/registry.ts, which ` +
      `is the client-safe module and imports no SDK.`,
  );
}

/* The verdict runs last, after the definitions above: `fail()` exits the process, so the breakdown
   has to be printed before it, and `explain` reads a `const` that is only initialised down here. */

if (WHY) explain(rows, total);

if (baseline !== null && total > baseline.bytes + HEADROOM_BYTES) {
  fail(
    `landing client JS is ${kb(total)} gzipped — ${kb(total - baseline.bytes)} over the ` +
      `${kb(baseline.bytes)} baseline written on ${baseline.measuredAt}, and §16 allows ` +
      `${kb(HEADROOM_BYTES)}. The headroom is a decision, not a target — cut the regression rather ` +
      `than raising the baseline.` +
      (WHY ? "" : " Re-run with --why for the per-module breakdown before deleting anything."),
  );
}
