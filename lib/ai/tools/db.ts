import { z } from "zod";
import { createAdmin } from "@/lib/supabase/admin";
import { msToTicks } from "@/lib/edl/time";
import { ToolError, ToolErrorKinds } from "./errors";

/**
 * The ONE place the planner's tools read analysis out of the database.
 *
 * THE RULE THIS FILE EXISTS FOR: a failed query must never look like "this clip has no data".
 * Every tool used to `const { data } = await admin.from(...)` and drop `error` on the floor, so a
 * rotated service key or a Supabase blip reached the model as `{ bpm: 0, beats: [] }` — an
 * authoritative negative it then asserted to the user ("there are no beats") and edited against.
 * Here, a PostgREST error THROWS a `ToolError` (surfaced to the loop as a tool failure) while a
 * genuinely absent row still returns `null`, which each tool renders as its graceful empty default.
 *
 * Reads are deterministic: `analysis` is unique on (asset_id, kind); `transcript` has no unique
 * constraint (duplicates are possible until the writer becomes an upsert), so it is read
 * newest-first with an explicit ORDER BY instead of "whatever row PostgREST happened to return".
 *
 * DB times are MILLISECONDS. Nothing here converts — the tools convert once, at their own output
 * boundary, with `msToTicks` from lib/edl/time.ts.
 */

type Admin = ReturnType<typeof createAdmin>;

/** The analysis kinds the `analysis.kind` check constraint allows (001_init.sql). */
export type AnalysisKind = "beats" | "scenes" | "faces" | "vlm_captions";

/** The shape of a PostgREST response, narrowed from supabase-js's untyped client at this boundary. */
interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/**
 * Fail loudly on a query error; pass a missing row through as `null`.
 * The message is written FOR THE MODEL: it must not be able to read a lookup failure as absence.
 */
function orThrow<T>(res: QueryResult<T>, what: string): T | null {
  if (res.error) {
    throw new ToolError(
      ToolErrorKinds.DB_ERROR,
      `Could not read ${what}: ${res.error.message}. This is a LOOKUP FAILURE, not an empty result — ` +
        `do NOT tell the user this clip has no ${what}. Say the analysis could not be read and stop.`,
    );
  }
  return res.data;
}

/**
 * One `analysis` row's `data` payload, or `null` when the pipeline has not produced it.
 * Callers narrow the payload themselves (each kind has its own shape).
 */
export async function readAnalysisData(
  assetId: string,
  kind: AnalysisKind,
  admin: Admin = createAdmin(),
): Promise<Record<string, unknown> | null> {
  const res: QueryResult<{ data: unknown }> = await admin
    .from("analysis")
    .select("data")
    .eq("asset_id", assetId)
    .eq("kind", kind)
    .maybeSingle();
  const row = orThrow(res, `the ${kind} analysis`);
  const payload = row?.data;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

/** A word as `lib/ai/transcribe.ts` writes it into `transcript.segments`. */
export const StoredTranscriptWord = z.object({
  t0Ms: z.number(),
  t1Ms: z.number(),
  word: z.string(),
});

/** A segment as `lib/ai/transcribe.ts` writes it into `transcript.segments`. */
export const StoredTranscriptSegment = z.object({
  startMs: z.number(),
  endMs: z.number(),
  text: z.string().default(""),
  words: z.array(StoredTranscriptWord).default([]),
});
export type StoredTranscriptWord = z.infer<typeof StoredTranscriptWord>;
export type StoredTranscriptSegment = z.infer<typeof StoredTranscriptSegment>;

export interface StoredTranscript {
  language: string | null;
  /** Chronological. Malformed entries are dropped; an entirely unparseable payload throws. */
  segments: StoredTranscriptSegment[];
}

/**
 * The newest transcript row for an asset, or `null` when transcription has not run.
 * A row whose `segments` payload cannot be parsed AT ALL throws rather than reporting "no speech" —
 * a schema change is a failure, not silence.
 */
export async function readTranscript(
  assetId: string,
  admin: Admin = createAdmin(),
): Promise<StoredTranscript | null> {
  const res: QueryResult<Array<{ language: string | null; segments: unknown }>> = await admin
    .from("transcript")
    .select("language, segments")
    .eq("asset_id", assetId)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = orThrow(res, "the transcript")?.[0];
  if (!row) return null;

  const raw = Array.isArray(row.segments) ? row.segments : null;
  if (!raw) {
    throw new ToolError(
      ToolErrorKinds.DB_ERROR,
      `The stored transcript for asset ${assetId} is not a segment array. This is a data-integrity ` +
        `failure, not an empty transcript — do NOT tell the user the clip has no speech.`,
    );
  }
  const segments = raw
    .map((s) => StoredTranscriptSegment.safeParse(s))
    .filter((p): p is { success: true; data: StoredTranscriptSegment } => p.success)
    .map((p) => p.data)
    .sort((a, b) => a.startMs - b.startMs);
  if (raw.length > 0 && segments.length === 0) {
    throw new ToolError(
      ToolErrorKinds.DB_ERROR,
      `The stored transcript for asset ${assetId} has ${raw.length} segment(s), none in the expected ` +
        `{startMs, endMs, text, words} shape. Do NOT tell the user the clip has no speech.`,
    );
  }
  return { language: row.language ?? null, segments };
}

/**
 * The asset's probed duration in MILLISECONDS, or `null` when it has not been probed.
 * A missing asset row throws: the IDOR guard already restricted the id to this project's assets,
 * so "not there" is an integrity failure the model must not plan around.
 */
export async function readAssetDurationMs(
  assetId: string,
  admin: Admin = createAdmin(),
): Promise<number | null> {
  const res: QueryResult<{ duration_ms: number | null }> = await admin
    .from("asset")
    .select("duration_ms")
    .eq("id", assetId)
    .maybeSingle();
  const row = orThrow(res, "the asset row");
  if (!row) {
    throw new ToolError(ToolErrorKinds.NOT_FOUND, `Asset ${assetId} does not exist.`);
  }
  const ms = row.duration_ms;
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** Keep only the finite, non-negative numbers out of a jsonb field the analysis writer produced. */
export function msNumbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0)
    : [];
}

/**
 * A stored millisecond array → editor ticks, the conversion every analysis tool owes the model.
 *
 * Wrapped in an explicit-arity callback on purpose: `.map(msToTicks)` hands the array INDEX to
 * msToTicks's second parameter (`tps`), so the second beat of a track converts at 1 tick per second
 * and 5000ms comes out as 5 — a legal-looking tick that puts the cut in the wrong place with
 * nothing to catch it downstream.
 */
/**
 * A stored array of millisecond RANGES → tick ranges.
 *
 * `lib/ffmpeg/scenes.ts` emits `scenes_ms` as `[number, number][]` — pairs, not a flat list. Running
 * that through `msArrayToTicks` returns `[]`, because a pair is not a number and the filter drops
 * it: the tool then reported `analyzed: true` with no scenes at all, which is the exact silent-empty
 * failure this codebase refuses everywhere else. The unit test that covered it fed the tool a FLAT
 * array the producer has never emitted, so it passed while the real shape was being discarded.
 */
export function msRangesToTicks(value: unknown): { startTick: number; endTick: number }[] {
  if (!Array.isArray(value)) return [];
  const out: { startTick: number; endTick: number }[] = [];
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [start, end] = pair;
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
    out.push({ startTick: msToTicks(start), endTick: msToTicks(end) });
  }
  return out;
}

export function msArrayToTicks(value: unknown): number[] {
  return msNumbers(value).map((ms) => msToTicks(ms));
}

/**
 * The units line every analysis tool puts on its result. Tool output is TICKS — the unit every
 * command field is in — so the model never has to multiply a millisecond list by 30 itself.
 */
export const TICKS_UNITS_NOTE = "All times are integer TICKS (30000 per second) — use them verbatim in commands.";
