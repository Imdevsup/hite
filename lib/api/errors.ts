import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * An error that already knows its own HTTP shape. `withAuth` returns `.response` verbatim, so any
 * route helper can abort with a correct status by throwing instead of threading a result union
 * through every call site. Anything that is NOT an `HttpError` stays a 500 — a server fault must
 * never be quietly relabelled as a client error.
 */
export class HttpError extends Error {
  readonly response: NextResponse;
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.response = NextResponse.json({ error: message }, { status });
  }
}

/** 400 — the request itself is wrong (bad JSON, schema violation). Never a 500. */
export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, message);
    this.name = "BadRequestError";
  }
}

/**
 * Maps a Supabase/PostgREST error to the correct HTTP status — so routes stop
 * (a) masking every failure as 404 and (b) returning 500 on an RLS denial.
 *
 * PostgREST error codes we care about:
 *   • 42501 / PGRST301 — RLS / insufficient privilege  → 403 (your data is fine, you're not allowed)
 *   • PGRST116          — "no rows" from .single()      → 404 (genuinely not found / not yours)
 *   • everything else                                   → 500 (real server fault — should alert)
 *
 * 403 vs 404 is deliberate: under RLS a row you don't own typically reads as PGRST116 (filtered
 * out → 404), while an explicit privilege error is 42501/PGRST301 (→ 403). Both keep 5xx noise off
 * dashboards for ordinary authz outcomes.
 */
export function httpStatusForDbError(error: { code?: string } | null | undefined): number {
  const code = error?.code;
  if (code === "42501" || code === "PGRST301") return 403;
  if (code === "PGRST116") return 404;
  return 500;
}

/**
 * Safe client-facing wording per status. Postgres/PostgREST `error.message` names columns,
 * constraints, policies and even function bodies — schema detail that maps our database for
 * anyone who can hit an authed route. The real message is logged, never returned.
 */
const CLIENT_MESSAGE: Record<number, string> = {
  403: "not allowed",
  404: "not found",
  500: "request failed",
};

/** Short correlation id so a user-reported "request failed" can be found in the platform log. */
function newErrorRef(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Convenience: build the JSON error response for a Supabase error with the right status.
 *
 * The body carries a generic message plus a `ref`; the driver's message and code go to the server
 * log under that same ref. Returning `error.message` verbatim (the previous behaviour) leaked
 * schema detail to every authed caller, and the `code` field leaked it a second time.
 */
export function dbErrorResponse(error: { code?: string; message?: string }): NextResponse {
  const status = httpStatusForDbError(error);
  const ref = newErrorRef();
  console.error(
    `[db-error] ref=${ref} status=${status} code=${error.code ?? "none"} message=${error.message ?? "none"}`,
  );
  return NextResponse.json({ error: CLIENT_MESSAGE[status] ?? "request failed", ref }, { status });
}

/**
 * A ZodError's `.message` is the raw issues JSON — sent verbatim it puts a wall of JSON in front of
 * the user (the AI chat renders route errors as-is). One short `field: message` line per issue
 * instead, capped so a batch that fails 40 ways doesn't become the whole reply.
 */
export function zodMessage(err: z.ZodError): string {
  const lines = err.issues.slice(0, 5).map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
  if (err.issues.length > lines.length) lines.push(`(+${err.issues.length - lines.length} more)`);
  return lines.join("; ");
}

/**
 * User-facing message for anything thrown behind a route — including inside an already-open SSE
 * stream, where the only way to report a failure is as an event. A ZodError (the Edl.parse tripwire
 * in the plan/refine pipeline) renders through `zodMessage` rather than as its raw issues array.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return zodMessage(e);
  return e instanceof Error ? e.message : String(e);
}

/**
 * For `.single()`/`.maybeSingle()` reads where a missing row should be 404 but you also want RLS
 * denials and real faults shaped correctly. Pass the `{ data, error }` straight from supabase.
 */
export function notFoundOrDbError(
  result: { data: unknown; error: { code?: string; message?: string } | null },
): NextResponse {
  if (result.error) return dbErrorResponse(result.error);
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
