/**
 * scripts/verify-provider.ts — THE ONLY THING ALLOWED TO MAKE A PROVIDER "WORK".
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The registry ships every provider and model as `untested`, and `ProviderModel` has no field a
 * contributor could set to change that. This script is the only writer of
 * `public/providers/verified.json`, which `lib/ai/providers/verification.ts` reads to derive every
 * badge in the settings UI. So "verified" cannot mean "someone believed it would work"; it can only
 * mean "this exact model drove HITE's real planner, and here is the date, the rung and the numbers".
 *
 * It drives the REAL `runPlanner` — the real system prompt, the real router (`selectToolSpecs`), the
 * real `FlatEditBatch` tool, the real `PlannerRun.dryRun` → `flatBatchToEditBatch` → `reduceBatch` →
 * `computeChecks`. Not a reimplementation. A pass therefore means "this model drives HITE", which is
 * the only claim worth making.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * USAGE
 *
 *   pnpm verify:provider -- --provider openai --model gpt-5.4-mini --yes
 *   pnpm verify:provider -- --provider google --model gemini-2.5-flash --rung high --runs 3 --yes
 *   pnpm verify:provider -- --provider anthropic --model claude-sonnet-5 --dry-run
 *
 *   --provider <id>     required. One of the registry's ids.
 *   --model <id>        defaults to the provider's first registry model. Free text is fine.
 *   --surface chat|responses   OpenAI/xAI only; each surface is a separate result row.
 *   --rung <level>      draft | standard | high | max. Default `standard`.
 *   --runs <n>          runs per prompt. Default 3 — a single green run is not evidence.
 *   --base-url <url>    the self-hosted provider only; must be loopback.
 *   --dry-run           print the exact call plan and spend nothing.
 *   --yes               required for a real run. It spends YOUR money.
 *   --out <path>        where to merge the result. Default public/providers/verified.json.
 *   --pause <ms>        wait between turns. Free tiers are per-MINUTE, so a back-to-back run 429s.
 *
 * THE KEY COMES FROM THE ENVIRONMENT, NEVER A FLAG — a flag lands in shell history and in `ps`.
 *   HITE_VERIFY_KEY=<key>       for any provider
 *   GEMINI_API_KEYS=<key,…>     accepted for `google` only, as a developer convenience. This is the
 *                               ONLY place in the repo that reads it; nothing on a request path does.
 * It is never echoed, never logged, and never written to the output — `verification.test.ts` asserts
 * the committed file carries no key material, and every error string goes through
 * `sanitizeProviderText` before it is printed or recorded.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * OFFLINE BY DEFAULT, AND WHY
 *
 * The analysis tools read the database. Requiring a live Supabase to test a MODEL would mean nobody
 * ever runs this. So the router selection is real and the tool surface the model sees is
 * byte-identical — the same `ToolSpec` objects, so the same names, descriptions and input schemas —
 * and only each tool's `execute` is swapped for a fixture. That isolates the single variable under
 * test: the model. It is reproducible, free of infrastructure, and comparable across machines and
 * dates, which is exactly what a verification record has to be.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PlannerContractError, parseTargetTicks } from "@/lib/ai/agents/critique";
import { runPlanner } from "@/lib/ai/agents/planner";
import { EFFORT, EFFORT_LEVELS, isEffort, type Effort } from "@/lib/ai/effort";
import { sanitizeProviderText } from "@/lib/ai/keys";
import { requireLoopbackBaseUrl, type KeySource } from "@/lib/ai/providers/credential";
import { findProviderEntry, providerAvailable } from "@/lib/ai/providers/registry";
import type { ModelSelection, ModelSurface, ProviderEntry } from "@/lib/ai/providers/types";
import type { PromptTally, RunRecord, Verdict } from "@/lib/ai/providers/verification";
import { selectToolSpecs } from "@/lib/ai/tools/router";
import { Edl, type Edl as EdlType } from "@/lib/edl/schema";
import { allClipPositions, locateClip } from "@/lib/edl/query";
import { TICKS_PER_SECOND } from "@/lib/edl/time";
import { summarizeEdl } from "@/lib/ai/timeline";
import type { PlannerRun } from "@/lib/ai/agents/critique";

const HARNESS_VERSION = "1.0.0";
const FIXTURE_ID = "3clip-2track-v1";
const DEFAULT_OUT = join("public", "providers", "verified.json");

/* ═════════════════════════════════════════════════════════════════════════════
   THE FIXTURE — a small, FIXED timeline, committed with the harness.

   Results are only comparable if the input is identical, so this is written out
   literally rather than generated: 3 clips across 2 tracks, 60s of timeline cut
   from a 90s asset, so a trim can EXTEND as well as shorten.
   ═════════════════════════════════════════════════════════════════════════ */

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_TICKS = 90 * TICKS_PER_SECOND;
const SECOND = TICKS_PER_SECOND;

const mediaRef = { schema: "MediaRef.1", url: "https://fixture.invalid/clip.mp4", availableInTick: 0, availableOutTick: ASSET_TICKS };
const clip = (id: string, inTick: number, outTick: number) => ({
  schema: "Clip.1",
  id,
  assetId: ASSET_ID,
  mediaRefs: { full: mediaRef },
  activeRefKey: "full",
  inTick,
  outTick,
  speed: 1,
  volume: 1,
  volumeEnvelope: [],
  effects: [],
});

function fixtureEdl(): EdlType {
  return Edl.parse({
    schema: "Edl.2",
    timebase: { ticksPerSecond: TICKS_PER_SECOND },
    durationTicks: 60 * SECOND,
    tracks: [
      {
        schema: "Track.1",
        id: "track_0",
        kind: "video",
        role: "main",
        items: [clip("c1", 0, 30 * SECOND), clip("c2", 30 * SECOND, 60 * SECOND)],
      },
      {
        schema: "Track.1",
        id: "track_1",
        kind: "video",
        role: "overlay",
        items: [clip("c3", 60 * SECOND, 70 * SECOND)],
      },
    ],
    metadata: { generatedBy: "seed" },
  });
}

const ASSET_CONTEXT = [{ id: ASSET_ID, filename: "fixture.mp4", duration_ms: 90_000 }];
const ASSET_DURATIONS = { [ASSET_ID]: ASSET_TICKS };

/** Filler spans the fixture transcript reports, in ticks. `grounded` is graded against these. */
const FILLER_SPANS = [
  { startTick: 5 * SECOND, endTick: 5 * SECOND + SECOND / 2, word: "um" },
  { startTick: 20 * SECOND, endTick: 20 * SECOND + SECOND / 2, word: "uh" },
  { startTick: 41 * SECOND, endTick: 41 * SECOND + SECOND / 2, word: "like" },
];
const FILLER_TOTAL_TICKS = FILLER_SPANS.reduce((sum, s) => sum + (s.endTick - s.startTick), 0);

/**
 * Canned analysis results, keyed by tool name.
 *
 * Deliberately small and plausible rather than rich: the point is that every model is shown the SAME
 * evidence, so a difference in outcome is a difference in the model. Any router-selected tool with
 * no entry here gets an explicit "no data" object rather than `undefined` — a tool result of
 * `undefined` would be an uncontrolled variable, and silence reads to a model as "nothing found".
 */
const NO_DATA = { note: "Offline verification fixture: no analysis data for this tool." } as const;

const TOOL_FIXTURES: Readonly<Record<string, unknown>> = {
  analyzeTranscript: {
    words: FILLER_SPANS.map((s) => ({ word: s.word, startTick: s.startTick, endTick: s.endTick })),
    note: "Fixture transcript: three filler words.",
  },
  findFillerWords: { spans: FILLER_SPANS, totalTicks: FILLER_TOTAL_TICKS },
  findSilences: { silences: [{ startTick: 12 * SECOND, endTick: 13 * SECOND }] },
  findHighlights: { highlights: [{ startTick: 8 * SECOND, endTick: 18 * SECOND, reason: "fixture highlight" }] },
  analyzeBeats: { bpm: 120, beats: [0, 15_000, 30_000, 45_000] },
  analyzeScenes: { scenes: [{ startTick: 0, endTick: 30 * SECOND }, { startTick: 30 * SECOND, endTick: 60 * SECOND }] },
  detectFaces: { faces: [] },
  planCutDown: { keep: [{ startTick: 0, endTick: 15 * SECOND }, { startTick: 30 * SECOND, endTick: 45 * SECOND }] },
  planSceneCuts: { cuts: [30 * SECOND] },
};

/* ═════════════════════════════════════════════════════════════════════════════
   THE CANONICAL PROMPT SET

   Six prompts, each chosen because it exercises a DIFFERENT way the loop breaks.
   No model judges its own work: every `satisfied` predicate is computed by the
   same deterministic code the product uses, over the real reduced timeline.
   ═════════════════════════════════════════════════════════════════════════ */

interface Observation {
  readonly before: EdlType;
  readonly after: EdlType | null;
  readonly run: PlannerRun;
  /** Tool names in the order the STREAM produced them, including `emitEditBatch`. */
  readonly toolCallOrder: readonly string[];
}

interface PromptSpec {
  readonly id: string;
  readonly prompt: string;
  /** What this prompt catches, printed in the run log so a red result is readable. */
  readonly catches: string;
  satisfied(o: Observation): boolean;
}

const EMIT = "emitEditBatch";
const within = (value: number, target: number, tolerance: number) => Math.abs(value - target) <= tolerance;

const PROMPTS: readonly PromptSpec[] = [
  {
    id: "structural-cut",
    prompt: "cut it down to 30 seconds",
    catches: "the headline capability — a measurement already showed 3/3 for one model and 0/3 for another",
    satisfied: ({ after }) => {
      if (!after) return false;
      const target = parseTargetTicks("cut it down to 30 seconds");
      if (target === null) return false; // guards the check itself, not the model
      return allClipPositions(after).length > 0 && within(after.durationTicks, target, target * 0.1);
    },
  },
  {
    id: "trim-edge",
    prompt: "trim the first two seconds off the second clip on the main track (c2)",
    catches: "precise field-level command emission — the model must move ONE edge and nothing else",
    satisfied: ({ before, after }) => {
      if (!after) return false;
      const c2 = locateClip(after, "c2");
      const c1 = locateClip(after, "c1");
      const c3 = locateClip(after, "c3");
      if (!c2 || !c1 || !c3) return false;
      const wasC2 = locateClip(before, "c2")!.clip;
      const wasC1 = locateClip(before, "c1")!.clip;
      const wasC3 = locateClip(before, "c3")!.clip;
      const movedBy = c2.clip.inTick - wasC2.inTick;
      const untouched = (a: { inTick: number; outTick: number }, b: { inTick: number; outTick: number }) =>
        a.inTick === b.inTick && a.outTick === b.outTick;
      return (
        within(movedBy, 2 * SECOND, SECOND / 2) && untouched(c1.clip, wasC1) && untouched(c3.clip, wasC3)
      );
    },
  },
  {
    id: "transition",
    prompt: "add a 1 second cross dissolve between the first two clips",
    catches: "the reducer's SILENT prune/clamp — the model reports success while the transition is gone",
    satisfied: ({ after }) => {
      if (!after) return false;
      return after.transitions.some(
        (t) =>
          ((t.betweenClipIds[0] === "c1" && t.betweenClipIds[1] === "c2") ||
            (t.betweenClipIds[0] === "c2" && t.betweenClipIds[1] === "c1")) &&
          // UNCLAMPED: a transition the reducer shortened is not the transition that was asked for.
          t.durationTicks === SECOND,
      );
    },
  },
  {
    id: "look-coverage",
    prompt: "give the whole video a warm film look",
    catches: "partial application that reports success — the `computeChecks` coverage finding",
    satisfied: ({ after }) => {
      if (!after) return false;
      const clips = allClipPositions(after);
      return clips.length > 0 && clips.every((p) => p.clip.effects.length > 0);
    },
  },
  {
    id: "impossible",
    prompt: "add the intro from the file I uploaded yesterday",
    catches: "FABRICATION. A cheap model invents an assetId here rather than saying it cannot",
    satisfied: ({ before, run }) => {
      // The prompt's sanctioned answer is a no-op emit carrying an explanation and NO commands.
      if (!run.noOp || run.noOp.summary.trim().length === 0) return false;
      // …and nothing may have been applied to the parent.
      return run.lastValid === null && before.tracks.length > 0;
    },
  },
  {
    id: "grounded",
    prompt: "cut out the filler words",
    catches: "C4 in action — the only prompt that fails loudly when `tool_choice` is ignored",
    satisfied: ({ before, after, toolCallOrder }) => {
      const emitAt = toolCallOrder.indexOf(EMIT);
      const investigatedFirst = emitAt > 0;
      if (!investigatedFirst || !after) return false;
      // The cuts must CORRESPOND to the fixture's filler spans: shorter than the parent, and by an
      // amount in the neighbourhood of the filler total rather than by a chunk of the video. The
      // tolerance is generous (±4s on a 1.5s target) because a model may legitimately round its cut
      // points to nearby frames or word boundaries; what it must not do is cut nothing, or cut wildly.
      const removed = before.durationTicks - after.durationTicks;
      return removed > 0 && removed < FILLER_TOTAL_TICKS + 4 * SECOND;
    },
  },
];

/* ═════════════════════════════════════════════════════════════════════════════
   CLI
   ═════════════════════════════════════════════════════════════════════════ */

interface Options {
  provider: string;
  model: string | null;
  surface: ModelSurface | null;
  rung: Effort;
  runs: number;
  baseUrl: string | null;
  dryRun: boolean;
  yes: boolean;
  out: string;
  /** Delay between turns. Free tiers are per-MINUTE, so a back-to-back run 429s within seconds. */
  pauseMs: number;
}

function die(message: string): never {
  console.error(`\n[verify-provider] ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Options {
  const flag = (name: string): string | null => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 && at + 1 < argv.length ? argv[at + 1] : null;
  };
  const has = (name: string) => argv.includes(`--${name}`);

  const provider = flag("provider");
  if (!provider) die("--provider is required. e.g. --provider openai");

  const rungRaw = flag("rung") ?? "standard";
  if (!isEffort(rungRaw)) die(`--rung must be one of ${EFFORT_LEVELS.join(" | ")}`);

  const runsRaw = flag("runs") ?? "3";
  const runs = Number.parseInt(runsRaw, 10);
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) die("--runs must be an integer between 1 and 20");

  const surfaceRaw = flag("surface");
  if (surfaceRaw !== null && surfaceRaw !== "chat" && surfaceRaw !== "responses") {
    die("--surface must be 'chat' or 'responses'");
  }

  const pauseRaw = flag("pause") ?? "0";
  const pauseMs = Number.parseInt(pauseRaw, 10);
  if (!Number.isInteger(pauseMs) || pauseMs < 0 || pauseMs > 120_000) {
    die("--pause must be a whole number of milliseconds between 0 and 120000");
  }

  return {
    provider,
    model: flag("model"),
    surface: surfaceRaw,
    rung: rungRaw,
    runs,
    baseUrl: flag("base-url"),
    dryRun: has("dry-run"),
    yes: has("yes"),
    out: flag("out") ?? DEFAULT_OUT,
    pauseMs,
  };
}

/**
 * The credential this process is running with, for the two top-level handlers at the bottom of this
 * file. They print text they did not compose (an SDK rejection, a thrown error) and they sit OUTSIDE
 * `main`, so without this they could only reach `sanitizeProviderText`'s PATTERN net.
 *
 * That net is `/AIza…/` and it is not enough on its own: measured against this repo's own working
 * Gemini keys on 2026-08-20, they are 53 characters, contain a `.`, and carry NO `AIza` prefix — so
 * the pattern matches none of them, and the exact-value pass is the only one that would fire. Set
 * once, next to the only reader, so "the key is never logged" is true of every exit path and not
 * just the ones inside `main`.
 */
let activeCredential: KeySource | undefined;

/**
 * The credential, from the environment only.
 *
 * `GEMINI_API_KEYS` is accepted for Google alone and ONLY here — it is a developer/test convenience,
 * not a product path, and nothing in a request path reads it. If it holds several keys the first is
 * used: the harness measures a MODEL, and rotating between credentials mid-measurement would make
 * the run unattributable.
 */
function readVerifyKey(entry: ProviderEntry): KeySource {
  const source = resolveVerifyKey(entry);
  activeCredential = source;
  return source;
}

function resolveVerifyKey(entry: ProviderEntry): KeySource {
  const explicit = process.env.HITE_VERIFY_KEY?.trim();
  if (explicit) return { kind: "byok", key: explicit };
  if (entry.id === "google") {
    const pooled = (process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (pooled.length > 0) return { kind: "byok", key: pooled[0] };
  }
  if (entry.auth.kind === "baseUrl") return { kind: "none" };
  return die(
    `no key. Set HITE_VERIFY_KEY to a ${entry.label} key in your environment ` +
      `(never as a flag — a flag lands in shell history).`,
  );
}

/* ═════════════════════════════════════════════════════════════════════════════
   ONE RUN
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * A failure of the RUNNER'S ENVIRONMENT, not of the model.
 *
 * This distinction is the difference between an honest result and a libel. A 429 means the key hit
 * its own quota; a 401 means the key is wrong. Neither says anything whatsoever about whether the
 * model can drive HITE — but both produce "no batch", which the grader would otherwise read as
 * `reduced: 0` and stamp `fail` on. The model would then carry a red "known issue" badge for
 * somebody's free-tier limit. So an infrastructure failure is NEVER graded.
 *
 * QUOTA IS WAITED OUT; AUTH IS NOT. The two need different handling and conflating them made the
 * harness unusable on exactly the keys most people have. Measured on 2026-08-20 against three
 * separate free-tier Google keys, at 15s, 60s and 90s between turns: each attempt completed 10-11
 * real turns and was then aborted by a per-minute limit, discarding every one of them — three
 * attempts, ~30 measured turns, zero recorded results. The honesty rule was right and the
 * abort-everything response to it was wrong: a quota error is a "come back shortly", and the
 * provider says how long. So a quota failure now WAITS (using the delay the provider itself states)
 * and re-runs the same turn, up to `QUOTA_RETRIES` times, and only then aborts. Nothing graded, no
 * work thrown away. An auth failure still aborts on the first sighting — no amount of waiting fixes
 * a credential the provider refuses, and retrying one just spends time to reach the same answer.
 */
export type InfraFailure = "quota" | "auth";

export function classifyInfraFailure(message: string): InfraFailure | null {
  const text = message.toLowerCase();
  if (/\b429\b|quota|rate.?limit|resource_exhausted|too many requests|overloaded/.test(text)) return "quota";
  if (/\b401\b|\b403\b|unauthorized|unauthenticated|permission_denied|invalid.?api.?key|api key not valid|incorrect api key|authentication/.test(text)) {
    return "auth";
  }
  return null;
}

/** How many times one turn may be waited out before the run gives up and records nothing. */
const QUOTA_RETRIES = 5;
/** Used when the provider does not say. Free per-minute windows are the common case. */
const QUOTA_FALLBACK_DELAY_MS = 45_000;
/** A provider asking for longer than this is a daily cap, not a window — stop rather than idle. */
const QUOTA_MAX_DELAY_MS = 150_000;

/**
 * The wait a provider ASKED for, in ms, or `null` when it did not say.
 *
 * Google states it twice in the same error — as prose ("Please retry in 22.608638895s.") and as a
 * `RetryInfo` detail (`"retryDelay":"22s"`) — so one pattern covers both rather than two that can
 * disagree. Read from the provider's own words instead of guessing a backoff curve: it knows when
 * the window rolls over and we do not.
 */
export function statedRetryDelayMs(message: string): number | null {
  const match = /retry(?:delay)?["'\s:]*(?:in\s+)?["']?(\d+(?:\.\d+)?)\s*s/i.exec(message);
  if (!match) return null;
  const seconds = Number.parseFloat(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

interface SingleRun {
  emitted: boolean;
  validated: boolean;
  reduced: boolean;
  satisfied: boolean;
  contractViolation: boolean;
  ms: number;
  checks: readonly string[];
  failure: string | null;
  /** Set ⇒ this run says nothing about the model and must not be graded. */
  infra: InfraFailure | null;
}

async function runOnce(
  spec: PromptSpec,
  selection: ModelSelection,
  credential: KeySource,
  rung: Effort,
): Promise<SingleRun> {
  const before = fixtureEdl();
  // The router runs for real; only each tool's `execute` is a fixture. Every selected tool gets an
  // entry so nothing is left to chance.
  const offlineToolResults = Object.fromEntries(
    selectToolSpecs(spec.prompt).map((s) => [s.name, TOOL_FIXTURES[s.name] ?? NO_DATA]),
  );

  const startedAt = Date.now();
  const toolCallOrder: string[] = [];
  let contractViolation = false;
  let failure: string | null = null;
  let validated = false;
  let lastEmitInput: unknown = null;

  const { stream, run } = await runPlanner({
    projectId: "verify",
    editId: "v1",
    parentSummary: summarizeEdl(before),
    prompt: spec.prompt,
    assetContext: ASSET_CONTEXT,
    mode: "plan",
    effort: EFFORT[rung],
    selection,
    credential,
    parentEdl: before,
    assetDurationsTicks: ASSET_DURATIONS,
    offlineToolResults,
  });

  try {
    // Walked exactly as /api/plan walks it, including the one-emit-per-step guard: a provider that
    // parallel-calls the emit must be graded broken here, before any user meets it.
    for await (const part of stream.fullStream) {
      if (part.type === "start-step") {
        run.beginStreamStep();
      } else if (part.type === "tool-call") {
        toolCallOrder.push(part.toolName);
        if (part.toolName === EMIT) {
          run.noteStreamEmit();
          lastEmitInput = part.input;
        }
      } else if (part.type === "tool-result" && part.toolName === EMIT) {
        const output = part.output as { kind?: string } | undefined;
        if (output?.kind === "applied" || output?.kind === "no-op") validated = true;
      } else {
        const type = part.type as string;
        if (type === "error" || type === "tool-error") {
          const err = (part as { error?: unknown }).error;
          throw err instanceof Error ? err : new Error(String(err ?? "planner stream error"));
        }
        if (type === "abort") throw new Error("planner stream aborted");
      }
    }
  } catch (e) {
    if (e instanceof PlannerContractError) contractViolation = true;
    failure = sanitizeProviderText(e instanceof Error ? e.message : String(e), credential);
  }

  // Same safety net the routes carry: draft's stop condition fires on the tool CALL, so the emit
  // tool may never have executed.
  if (run.emitCount === 0 && lastEmitInput !== null) {
    const result = run.dryRun(lastEmitInput);
    if (result.kind !== "rejected") validated = true;
  }

  const after = run.lastValid?.edl ?? null;
  const observation: Observation = { before, after, run, toolCallOrder };
  const checks = after ? [] : run.lastProblems;

  return {
    emitted: run.emitCount > 0 || lastEmitInput !== null,
    validated,
    reduced: after !== null || run.noOp !== null,
    satisfied: contractViolation ? false : spec.satisfied(observation),
    contractViolation,
    ms: Date.now() - startedAt,
    checks,
    failure,
    infra: failure === null ? null : classifyInfraFailure(failure),
  };
}

class InfraAbort extends Error {
  constructor(
    readonly kind: InfraFailure,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "InfraAbort";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * One turn, waiting out a quota window rather than throwing the whole measurement away.
 *
 * The returned run is either a real measurement or an un-waitable infra failure; a quota attempt
 * that was retried is DISCARDED, so nothing a rate limiter did ever reaches `grade`. The wait is the
 * provider's own stated delay plus a second of slack, because a window that has "just" rolled over
 * has not.
 */
async function runQuotaAware(
  spec: PromptSpec,
  selection: ModelSelection,
  credential: KeySource,
  rung: Effort,
  label: string,
): Promise<SingleRun> {
  for (let attempt = 0; ; attempt++) {
    const result = await runOnce(spec, selection, credential, rung);
    if (result.infra !== "quota" || attempt >= QUOTA_RETRIES) return result;

    const stated = statedRetryDelayMs(result.failure ?? "");
    if (stated !== null && stated > QUOTA_MAX_DELAY_MS) {
      // Longer than a window: this is a daily cap. Waiting it out would idle for hours, so hand the
      // failure back and let the caller abort with the provider's own words.
      return result;
    }
    const wait = (stated ?? QUOTA_FALLBACK_DELAY_MS) + 1_000;
    console.log(
      `  ${label.padEnd(24)} quota — waiting ${Math.round(wait / 1000)}s and re-running ` +
        `(${attempt + 1}/${QUOTA_RETRIES}); this attempt is discarded, never graded`,
    );
    await sleep(wait);
  }
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/* ═════════════════════════════════════════════════════════════════════════════
   GRADING — computed here, never by hand
   ═════════════════════════════════════════════════════════════════════════ */

/**
 *  pass    ⇔ EVERY prompt: reduced ≥ ⌈2N/3⌉ and satisfied ≥ ⌈2N/3⌉ and contractViolations === 0
 *  fail    ⇔ any prompt reduced 0 of N, or any contract violation, or the run errored throughout
 *  partial ⇔ anything in between
 *
 * `partial` maps to the UI's `broken`, not to `verified`. That is deliberate and it has a cost: a
 * genuinely useful 5-of-6 model gets a red badge. The cost is taken on purpose, because the standard
 * is "a dropdown of thirty providers where half silently fail is worse than four that are known
 * good" — and the `reason` string keeps it honest rather than opaque, so a user reading "passes
 * structural cuts; drops the requested transition in 2/3 runs" can still choose it knowingly.
 */
function grade(tallies: readonly PromptTally[], runs: number): { verdict: Verdict; reason: string | null } {
  const threshold = Math.ceil((2 * runs) / 3);
  const problems: string[] = [];
  let anyDead = false;

  for (const t of tallies) {
    if (t.contractViolations > 0) {
      problems.push(`${t.id}: emitted two batches in one step (${t.contractViolations}/${runs} runs)`);
      anyDead = true;
      continue;
    }
    if (t.reduced === 0) {
      problems.push(`${t.id}: produced no applicable batch in any of ${runs} runs`);
      anyDead = true;
      continue;
    }
    if (t.reduced < threshold) problems.push(`${t.id}: only ${t.reduced}/${runs} runs produced an applicable batch`);
    if (t.satisfied < threshold) problems.push(`${t.id}: only ${t.satisfied}/${runs} runs did what was asked`);
  }

  if (anyDead) return { verdict: "fail", reason: problems.join("; ") };
  if (problems.length > 0) return { verdict: "partial", reason: problems.join("; ") };
  return { verdict: "pass", reason: null };
}

/* ═════════════════════════════════════════════════════════════════════════════
   OUTPUT
   ═════════════════════════════════════════════════════════════════════════ */

function installedVersion(pkg: string): string {
  try {
    const json = JSON.parse(readFileSync(join(process.cwd(), "node_modules", ...pkg.split("/"), "package.json"), "utf8")) as {
      version: string;
    };
    return `${pkg}@${json.version}`;
  } catch {
    return `${pkg}@unknown`;
  }
}

/**
 * Append the record. History is kept rather than overwritten: `verificationFor` takes the newest
 * matching row, so a regression stays visible in the diff instead of quietly replacing a green run.
 */
function mergeResult(out: string, record: RunRecord): void {
  // `resolve`, not `join`: an absolute `--out` must not be pasted onto the cwd.
  const path = resolve(process.cwd(), out);
  let file: { schema: number; note?: string; runs: RunRecord[] };
  try {
    file = JSON.parse(readFileSync(path, "utf8")) as typeof file;
  } catch {
    file = { schema: 1, runs: [] };
  }
  if (!Array.isArray(file.runs)) file.runs = [];
  file.runs.push(record);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

/* ═════════════════════════════════════════════════════════════════════════════
   MAIN
   ═════════════════════════════════════════════════════════════════════════ */

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const entry = findProviderEntry(options.provider);
  if (!entry) die(`unknown provider '${options.provider}'`);
  if (!providerAvailable(entry)) {
    die(`'${entry.id}' is off on this machine — set HITE_ALLOW_LOCAL_PROVIDER=1 to verify it`);
  }

  const model = options.model ?? entry.models[0]?.id;
  if (!model) die(`--model is required for '${entry.id}': it ships no default model list`);

  const baseUrl =
    entry.auth.kind === "baseUrl" ? requireLoopbackBaseUrl(options.baseUrl ?? entry.auth.defaultBaseUrl) : null;

  const selection: ModelSelection = {
    providerId: entry.id,
    model,
    surface: options.surface ?? entry.models.find((m) => m.id === model)?.surface ?? null,
    baseUrl,
  };

  const turns = PROMPTS.length * options.runs;
  const plan =
    `${PROMPTS.length} prompts x ${options.runs} runs x 1 model = ${turns} planner turns\n` +
    `  provider : ${entry.id}${entry.npm ? ` (${entry.npm.pkg})` : ""}\n` +
    `  model    : ${model}${selection.surface ? ` [${selection.surface}]` : ""}\n` +
    `  rung     : ${options.rung} (steps ${EFFORT[options.rung].steps}, revisions ${EFFORT[options.rung].revisions}, ` +
    `grounding ${EFFORT[options.rung].groundSteps}, thinking ${EFFORT[options.rung].thinking})\n` +
    `  mode     : offline (fixture ${FIXTURE_ID}) — the router and the tool surface are real\n` +
    `  output   : ${options.out}`;

  console.log(`\n[verify-provider] plan\n${plan}\n`);
  for (const p of PROMPTS) console.log(`  · ${p.id.padEnd(16)} ${p.catches}`);
  console.log("");

  if (options.dryRun) {
    console.log("[verify-provider] --dry-run: nothing was called and nothing was spent.\n");
    return;
  }
  if (!options.yes) {
    die("this spends YOUR money on YOUR key. Re-run with --yes once the plan above looks right.");
  }

  const credential = readVerifyKey(entry);

  const tallies: PromptTally[] = [];
  for (const spec of PROMPTS) {
    const results: SingleRun[] = [];
    for (let i = 0; i < options.runs; i++) {
      if (options.pauseMs > 0 && (results.length > 0 || tallies.length > 0)) await sleep(options.pauseMs);
      // A quota failure is waited out and re-run; an auth failure aborts. Either way the failed
      // attempt is DISCARDED, never graded — see the note on `InfraFailure`.
      const result = await runQuotaAware(spec, selection, credential, options.rung, `${spec.id} ${i + 1}/${options.runs}`);
      if (result.infra) throw new InfraAbort(result.infra, result.failure ?? "");
      results.push(result);
      const mark = result.satisfied ? "PASS" : result.reduced ? "weak" : "FAIL";
      console.log(
        `  ${spec.id.padEnd(16)} run ${i + 1}/${options.runs}  ${mark.padEnd(5)} ${result.ms}ms` +
          (result.failure ? `  — ${result.failure}` : ""),
      );
    }
    const tally: PromptTally = {
      id: spec.id,
      emitted: results.filter((r) => r.emitted).length,
      validated: results.filter((r) => r.validated).length,
      reduced: results.filter((r) => r.reduced).length,
      satisfied: results.filter((r) => r.satisfied).length,
      contractViolations: results.filter((r) => r.contractViolation).length,
      medianMs: median(results.map((r) => r.ms)),
      checks: [...new Set(results.flatMap((r) => r.checks))],
      // Only the FIRST failure, already sanitised — a wall of repeated provider text helps nobody.
      failure: results.find((r) => r.failure)?.failure ?? null,
    };
    tallies.push(tally);
  }

  const { verdict, reason } = grade(tallies, options.runs);
  const record: RunRecord = {
    provider: entry.id,
    model,
    surface: selection.surface,
    rung: options.rung,
    runsPerPrompt: options.runs,
    at: new Date().toISOString(),
    harness: HARNESS_VERSION,
    mode: "offline",
    fixture: FIXTURE_ID,
    versions: {
      ai: installedVersion("ai").split("@").pop() ?? "unknown",
      provider: entry.npm ? installedVersion(entry.npm.pkg) : "none",
      node: process.versions.node,
    },
    prompts: tallies,
    verdict,
    reason,
  };

  mergeResult(options.out, record);

  console.log(`\n[verify-provider] verdict: ${verdict.toUpperCase()}`);
  if (reason) console.log(`[verify-provider] reason: ${reason}`);
  console.log(`[verify-provider] merged into ${options.out} — commit it to publish the badge.\n`);

  // A non-zero exit for anything but a pass, so CI can gate on it.
  if (verdict !== "pass") process.exitCode = 1;
}

/**
 * The AI SDK's result object exposes promise properties (`.text`, `.usage`, …) that reject when the
 * stream faults. The harness measures via `fullStream` and never awaits them, so Node reports the
 * rejection as unhandled — a wall of provider JSON that buries the one line that matters. The fault
 * itself is already captured and sanitised in `runOnce`, so this only suppresses the duplicate; it
 * still prints a bounded, redacted line rather than swallowing it, because a silent handler here
 * would also hide a real bug in the harness.
 */
process.on("unhandledRejection", (reason: unknown) => {
  const text = sanitizeProviderText(reason instanceof Error ? reason.message : String(reason), activeCredential);
  console.warn(`[verify-provider] (duplicate stream rejection, already recorded) ${text.slice(0, 160)}`);
});

main().catch((e: unknown) => {
  if (e instanceof InfraAbort) {
    const advice =
      e.kind === "quota"
        ? "Your key hit its own quota — that is a fact about the KEY, not about the model, so NOTHING was " +
          "recorded. Free tiers are per-minute: re-run with e.g. `--pause 20000`, or use a key with headroom."
        : "The provider rejected the credential — check HITE_VERIFY_KEY. Nothing was recorded.";
    console.error(
      `\n[verify-provider] aborted (${e.kind}). ${advice}\n  provider said: ${sanitizeProviderText(e.detail, activeCredential).slice(0, 300)}\n`,
    );
    process.exit(2);
  }
  // BOTH nets, not just the pattern one — see `activeCredential`. An SDK error can quote the very key
  // it was handed, and for a modern non-`AIza` key the exact-value pass is the only one that fires.
  console.error(`\n[verify-provider] failed: ${sanitizeProviderText(e instanceof Error ? e.message : String(e), activeCredential)}\n`);
  process.exit(1);
});
