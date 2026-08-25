"use client";
import { useEffect, useState } from "react";
import {
  WORKER_IDLE_HINT,
  WORKER_IDLE_HINT_MS,
  analysisBranchesForKind,
  type AnalysisBranch,
  type JobStatus,
} from "@/lib/jobs/types";
import type { AssetKind } from "@/lib/storage/media";

/**
 * The branches the route can report. A SET, not a legend — the names are never printed.
 *
 * THEY USED TO BE, as `SPEECH · BEATS · SCENES` pills, and that is a capability claim this build
 * cannot honour. The beats branch really runs, but nothing consumes it: `planBeatCuts` returns
 * `{ bpm: 0, cutTicks: [] }`, so the timeline cannot be cut to a beat. Telling a first-time user
 * "working out beats" invites the one prompt the brief bans by name — "Beat detection is NOT wired —
 * never show beat-sync" — and the invitation would come from the product itself. The COUNT is honest
 * and useful ("something is still running, here is how far"); the NAMES are not, so they are gone.
 */
const BRANCHES: Record<AnalysisBranch, true> = { transcribe: true, beats: true, scenes: true };

/** What GET /api/analyze/[assetId] answers with. Every field is treated as untrusted. */
export interface AnalyzeStatus {
  branches: AnalysisBranch[];
  done: AnalysisBranch[];
  /** null means no analyze job was ever created for this asset — distinct from "queued". */
  status: JobStatus | null;
  error: string | null;
}

/**
 * How many polls a `status: null` is allowed to be a race with the POST that queues the job before
 * it is read as "nobody ever asked for this". The POST is fired without being awaited, so the first
 * tick genuinely can beat the row into existence.
 */
const MISSING_JOB_GRACE_TICKS = 4;
/** Consecutive unreadable responses before the poll gives up rather than hammering a broken route. */
const MAX_CONSECUTIVE_ERRORS = 5;
const POLL_MS = 1500;
/**
 * How long a job may sit `queued` before the line says nothing has claimed it, counted in polls
 * because polls are what this component has. The first tick fires immediately, so the wait is a
 * poll shorter than WORKER_IDLE_HINT_MS — near enough for a hint, and erring late rather than early.
 */
const UNCLAIMED_TICKS = Math.ceil(WORKER_IDLE_HINT_MS / POLL_MS);

export type AnalyzePhase =
  | "waiting"
  | "analysing"
  | "unclaimed"
  | "complete"
  | "failed"
  | "not-started"
  | "unreachable";

export interface PhaseInput {
  /** null until the first response lands. */
  status: AnalyzeStatus | null;
  consecutiveMissingJob: number;
  /** Consecutive polls that found the job still `queued` — never claimed, not merely slow. */
  consecutiveQueued: number;
  consecutiveErrors: number;
}

/**
 * The one decision this component makes, kept pure so it can be tested.
 *
 * It exists because the previous version could not reach a terminal state at all: it counted
 * against a hardcoded FOUR branches (including `faces`, a pipeline that was cut), while the route
 * reports at most three for a video and two for audio. `clearInterval` was therefore unreachable —
 * the component fetched every 1.5 s for the life of the page and the header read "ANALYSING 3/4"
 * forever — and it read neither the `status` nor the `error` the route now returns, so a job that
 * had already failed with a real reason still showed as work in progress.
 */
export function analyzePhase({
  status,
  consecutiveMissingJob,
  consecutiveQueued,
  consecutiveErrors,
}: PhaseInput): AnalyzePhase {
  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return "unreachable";
  if (!status) return "waiting";
  if (status.status === "failed") return "failed";
  if (status.status === "succeeded") return "complete";
  if (status.branches.length > 0 && status.done.length >= status.branches.length) return "complete";
  if (status.status === null && consecutiveMissingJob >= MISSING_JOB_GRACE_TICKS) return "not-started";
  // The job exists and nothing has claimed it. Still work in progress as far as the queue is
  // concerned, so the poll continues — this only changes what the line SAYS while it waits.
  if (status.status === "queued" && consecutiveQueued >= UNCLAIMED_TICKS) return "unclaimed";
  return "analysing";
}

/** Only these are still waiting on something; everything else is an answer. */
export function isPolling(phase: AnalyzePhase): boolean {
  return phase === "waiting" || phase === "analysing" || phase === "unclaimed";
}

/**
 * ONE LINE, AND ONLY WHILE IT IS TRUE — §13's rule about readouts applied to the one background
 * process the user genuinely needs to know about.
 *
 * WHY THIS IS ON SCREEN AT ALL, when almost nothing else is. "cut the dead air" reads a TRANSCRIPT.
 * If analysis has not landed, the planner's own tools report `transcribed: false` and the honest
 * answer is "this clip hasn't been analysed yet" — a first-time user who typed the product's own
 * example sentence and got that back has no way to know it is a matter of waiting. So the wait is
 * stated, once, in a sentence.
 *
 * WHAT IT NO LONGER IS. A segmented progress rail, one pill per branch, a `1/3` counter and a live
 * amber tick, all at 9px — under §5's hard 12px floor, and four devices where one clause does. The
 * count against a HARDCODED FOUR branches (including `faces`, whose pipeline is cut) is the bug the
 * pure `analyzePhase` below was written to kill; it is unchanged, and so is its test.
 *
 * NO FABRICATED PROGRESS. The worker reports which branches have landed and nothing finer, so this
 * says how many of how many — never a percentage and never an ETA. A failed job says so in the
 * worker's own words instead of spinning, and a finished one says nothing at all.
 */
export function AnalyzeProgress({ assetId, kind }: { assetId: string | null; kind: AssetKind }) {
  // Seeded from the SAME function the route derives its denominator with, so the line is right on the
  // very first paint and the two can never disagree.
  const [status, setStatus] = useState<AnalyzeStatus | null>(null);
  const [phase, setPhase] = useState<AnalyzePhase>("waiting");

  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    /** The last reading, held here rather than in state so the poll never reads a stale closure. */
    let latest: AnalyzeStatus | null = null;
    let consecutiveMissingJob = 0;
    let consecutiveQueued = 0;
    let consecutiveErrors = 0;

    // `stopped` rather than `interval === null`: the first tick runs before the interval exists, so
    // an answer that arrives immediately has to be able to stop a poll that has not started yet.
    let stopped = false;
    const stop = () => {
      stopped = true;
      if (interval) clearInterval(interval);
      interval = null;
    };

    const tick = async () => {
      try {
        const res = await fetch(`/api/analyze/${assetId}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const next = readStatus(await res.json());
        if (cancelled) return;
        latest = next;
        consecutiveErrors = 0;
        consecutiveMissingJob = next.status === null ? consecutiveMissingJob + 1 : 0;
        consecutiveQueued = next.status === "queued" ? consecutiveQueued + 1 : 0;
        setStatus(next);
      } catch {
        if (cancelled) return;
        consecutiveErrors += 1;
      }
      const resolved = analyzePhase({ status: latest, consecutiveMissingJob, consecutiveQueued, consecutiveErrors });
      setPhase(resolved);
      // THE line that used to be unreachable. Every path out of the poll now has an end.
      if (!isPolling(resolved)) stop();
    };

    void tick();
    if (!stopped) interval = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [assetId]);

  if (!assetId) return null;
  // Nothing to say once it has landed. A readout that reports success is a readout nobody needs.
  if (phase === "complete") return null;

  const branches = status?.branches ?? analysisBranchesForKind(kind);
  if (branches.length === 0) return null;
  const done = new Set(status?.done ?? []);

  const line =
    phase === "failed"
      ? "HITE couldn't read this video, so edits that depend on what's in it won't work yet."
      : phase === "not-started"
        ? "Nobody has asked HITE to read this video yet, so it can't use what's in it."
        : phase === "unreachable"
          ? "HITE can't tell whether this video has been read yet."
          : phase === "unclaimed"
            ? WORKER_IDLE_HINT
            : `Reading your video — ${done.size} of ${branches.length} done. Anything that depends on what's in it works better once this finishes.`;

  return (
    <p
      role="status"
      aria-live="polite"
      className="mt-[var(--space-3)] text-[12px] leading-relaxed"
      style={{ color: phase === "failed" ? "var(--color-hit)" : "var(--t-3)" }}
    >
      {line}
      {/* The worker's own sentence — a missing GROQ_API_KEY, ffmpeg's own diagnosis of a corrupt
          file. Shown instead of a spinner, which is what this whole path was for. */}
      {phase === "failed" && status?.error && (
        <span className="ml-[var(--space-2)] font-mono text-[var(--t-4)]">{status.error}</span>
      )}
    </p>
  );
}

const BRANCH_NAMES = new Set<string>(Object.keys(BRANCHES));
const JOB_STATUSES = new Set<string>(["queued", "running", "succeeded", "failed"]);

/** Narrow the response without trusting it — an unexpected shape must not read as "done". */
function readStatus(body: unknown): AnalyzeStatus {
  const raw = (body ?? {}) as Record<string, unknown>;
  const branches = asBranches(raw.branches);
  return {
    branches,
    // A branch the route did not list cannot be counted as progress against it.
    done: asBranches(raw.done).filter((b) => branches.includes(b)),
    status: typeof raw.status === "string" && JOB_STATUSES.has(raw.status) ? (raw.status as JobStatus) : null,
    error: typeof raw.error === "string" ? raw.error : null,
  };
}

function asBranches(value: unknown): AnalysisBranch[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is AnalysisBranch => typeof v === "string" && BRANCH_NAMES.has(v));
}
