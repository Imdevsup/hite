import results from "@/public/providers/verified.json";
import type { Effort } from "@/lib/ai/effort";
import { EFFORT_LEVELS } from "@/lib/ai/effort";
import type { ModelSurface, ProviderId } from "./types";

/**
 * VERIFICATION IS A DERIVATION, NEVER A FIELD.
 *
 * `ProviderModel` (types.ts) has no `verified` property, so there is nowhere in the registry to
 * hand-assert that a model works. The only input is `public/providers/verified.json`, which only
 * `scripts/verify-provider.ts` writes, and only by driving the REAL planner → real flat mapper →
 * real reducer → real `computeChecks` over a canonical prompt set. That is what makes "verified"
 * mean "this model drives HITE" rather than "someone believed it would".
 *
 * A MODULE IMPORT, NOT `readFileSync` — a serverless function has no repo on disk, and a runtime
 * file read 500s in production (CLAUDE.md §5). It is also why the file lives under `public/`: it is
 * a small, non-secret, generated artifact that is equally useful to the browser and the bundler.
 *
 * NOTHING BELOW TRUSTS THE JSON. It is a committed artifact a contributor can edit by hand, so it is
 * narrowed exactly as an HTTP body would be, and every ambiguity resolves DOWNWARD: a `verified`
 * record missing the date or the rung that scopes the claim becomes `untested`; an unparseable
 * record becomes `untested`; a record from a different AI SDK major becomes `untested`. Downgrades
 * are safe. An upgrade is how a dropdown of thirty providers ends up half silently failing.
 */

export type VerificationState = "verified" | "untested" | "broken";

export type Verification =
  | {
      readonly state: "verified";
      /** `YYYY-MM-DD`. Half of the claim's scope — a green run against a different SDK is not evidence. */
      readonly at: string;
      /** The other half: verified AT a rung, not in general. */
      readonly rung: Effort;
      /** Runs per prompt behind the verdict. `null` when the record did not say. */
      readonly runs: number | null;
    }
  | { readonly state: "broken"; readonly at: string | null; readonly reason: string }
  | { readonly state: "untested" };

/**
 * The AI SDK major these results are evidence for.
 *
 * A run recorded against a different major is not evidence about this build: `@ai-sdk/provider`'s
 * language-model interface changes across it, which is the whole subject of U8 §2. Bump this in the
 * same commit as an `ai@7` upgrade and every existing result correctly reverts to `untested` until
 * re-measured. Hardcoded rather than read from `ai`'s package.json because that package does not
 * export it, and a wrong-but-confident read here would defeat the check.
 */
export const VERIFIED_AI_MAJOR = 6;

/** One prompt's tally inside a run record. Kept as data for diagnostics; the verdict is precomputed. */
export interface PromptTally {
  readonly id: string;
  readonly emitted: number;
  readonly validated: number;
  readonly reduced: number;
  readonly satisfied: number;
  readonly contractViolations: number;
  readonly medianMs: number;
  readonly checks: readonly string[];
  readonly failure: string | null;
}

export type Verdict = "pass" | "fail" | "partial";

export interface RunRecord {
  readonly provider: ProviderId;
  readonly model: string;
  readonly surface: ModelSurface | null;
  readonly rung: Effort;
  readonly runsPerPrompt: number;
  /** ISO 8601 timestamp. */
  readonly at: string;
  readonly harness: string;
  readonly mode: "offline" | "live";
  readonly fixture: string;
  readonly versions: { readonly ai: string; readonly provider: string; readonly node: string };
  readonly prompts: readonly PromptTally[];
  readonly verdict: Verdict;
  readonly reason: string | null;
}

export interface VerificationFile {
  readonly schema: 1;
  readonly note?: string;
  readonly runs: readonly RunRecord[];
}

/* ── narrowing ─────────────────────────────────────────────────────────────── */

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** `YYYY-MM-DD` off the front of an ISO timestamp. Deterministic: no locale, no timezone. */
function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function isEffortLevel(value: unknown): value is Effort {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}

/** `6.0.168` → `6`. `null` when the string is not a version we can read a major out of. */
export function majorOf(version: string): number | null {
  const major = Number.parseInt(version.trim().replace(/^[^\d]*/, ""), 10);
  return Number.isInteger(major) ? major : null;
}

/**
 * The parsed run list. Anything that does not narrow cleanly is DROPPED rather than repaired — a
 * half-understood record is not evidence, and silently repairing one is how a bad record earns a
 * badge. Computed once at module load; the file is a build-time constant.
 */
const RUNS: readonly RunRecord[] = readRuns(results);

function readRuns(raw: unknown): RunRecord[] {
  const file = record(raw);
  if (!file || !Array.isArray(file.runs)) return [];
  const out: RunRecord[] = [];
  for (const entry of file.runs) {
    const row = record(entry);
    if (!row) continue;
    const provider = text(row.provider);
    const model = text(row.model);
    const at = text(row.at);
    const verdict = row.verdict;
    if (!provider || !model || !at) continue;
    if (verdict !== "pass" && verdict !== "fail" && verdict !== "partial") continue;
    if (!isEffortLevel(row.rung)) continue;
    const versions = record(row.versions);
    out.push({
      provider: provider as ProviderId,
      model,
      surface: row.surface === "chat" || row.surface === "responses" ? row.surface : null,
      rung: row.rung,
      runsPerPrompt: count(row.runsPerPrompt) ?? 0,
      at,
      harness: text(row.harness) ?? "unknown",
      mode: row.mode === "live" ? "live" : "offline",
      fixture: text(row.fixture) ?? "unknown",
      versions: {
        ai: (versions && text(versions.ai)) ?? "unknown",
        provider: (versions && text(versions.provider)) ?? "unknown",
        node: (versions && text(versions.node)) ?? "unknown",
      },
      prompts: readPrompts(row.prompts),
      verdict,
      reason: text(row.reason),
    });
  }
  return out;
}

function readPrompts(raw: unknown): PromptTally[] {
  if (!Array.isArray(raw)) return [];
  const out: PromptTally[] = [];
  for (const entry of raw) {
    const row = record(entry);
    const id = row && text(row.id);
    if (!row || !id) continue;
    out.push({
      id,
      emitted: count(row.emitted) ?? 0,
      validated: count(row.validated) ?? 0,
      reduced: count(row.reduced) ?? 0,
      satisfied: count(row.satisfied) ?? 0,
      contractViolations: count(row.contractViolations) ?? 0,
      medianMs: count(row.medianMs) ?? 0,
      checks: Array.isArray(row.checks) ? row.checks.filter((c): c is string => typeof c === "string") : [],
      failure: text(row.failure),
    });
  }
  return out;
}

/* ── the derivation ────────────────────────────────────────────────────────── */

const UNTESTED: Verification = { state: "untested" };

/** Every parsed record, newest first. Exported so the harness and its tests read the same view. */
export function allRuns(): readonly RunRecord[] {
  return RUNS;
}

/**
 * The verification badge for one (provider, model, surface).
 *
 * NEWEST WINS, and only among runs that are evidence for THIS build. `partial` maps to `broken`, not
 * to `verified`: a model that passes structural cuts but drops the requested transition in 2 of 3
 * runs is not "works", and the `reason` string keeps that honest rather than opaque — a user reading
 * "passes structural cuts; drops transitions" can still choose it knowingly through the override.
 *
 * A run is looked up by the rung it was measured at only implicitly: the record CARRIES its rung and
 * the badge states it, because "verified" without a rung is a claim with no scope.
 */
export function verificationFor(
  provider: ProviderId,
  model: string,
  surface: ModelSurface | null = null,
): Verification {
  let best: RunRecord | null = null;
  for (const run of RUNS) {
    if (run.provider !== provider || run.model !== model) continue;
    if (surface !== null && run.surface !== null && run.surface !== surface) continue;
    if (majorOf(run.versions.ai) !== VERIFIED_AI_MAJOR) continue; // stale evidence is not evidence
    if (!best || run.at > best.at) best = run;
  }
  if (!best) return UNTESTED;

  if (best.verdict === "pass") {
    const at = isoDate(best.at);
    // A pass whose date we cannot read has lost half its scope, so it fails closed.
    if (!at) return UNTESTED;
    return { state: "verified", at, rung: best.rung, runs: best.runsPerPrompt > 0 ? best.runsPerPrompt : null };
  }
  return {
    state: "broken",
    at: isoDate(best.at),
    reason: best.reason ?? "the provider check did not pass and recorded no reason",
  };
}
