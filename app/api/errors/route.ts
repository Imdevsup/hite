import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonText } from "@/lib/api/body";
import { HttpError } from "@/lib/api/errors";
import { clientIpKey, requireIpRateLimit } from "@/lib/api/rate-limit";

/**
 * Client error collection. Deliberately UNAUTHENTICATED — a crash on the landing page or during
 * login is exactly the report we most want, and requiring a session would drop it.
 *
 * Unauthenticated + "log whatever you're given" is a log-injection, log-spam and log-cost sink, so
 * everything attacker-controlled here is bounded before it reaches the platform log:
 *   • the raw text is capped BEFORE parsing (a 5 MB report is not a report),
 *   • the shape is strict — unknown keys are rejected, not logged,
 *   • message/context are truncated and flattened to one line, so newlines cannot forge log records,
 *   • the whole endpoint is IP rate limited (`client-error` bucket, migration 004).
 * Sentry replaces this wholesale later (lib/sentry.ts); until then this is the only sink.
 */

/**
 * Ceiling on the whole payload. Applied to the raw TEXT, because truncated JSON does not parse —
 * this is the one bound that has to reject rather than trim, and it is set well above a real report.
 */
const MAX_BODY_CHARS = 4_096;
/** What actually reaches the log line, per field. */
const MAX_LOG_CHARS = 500;

/**
 * Matches what lib/sentry.ts actually posts. `.strict()` so probing keys are rejected, not logged.
 *
 * `message` has NO max: a length cap here 400s the report instead of trimming it, and the reports
 * that overflow are the stack-carrying ones we most want. Length is bounded twice already — by
 * MAX_BODY_CHARS on the way in and by `oneLine(..., MAX_LOG_CHARS)` on the way to the log — and the
 * caller (lib/sentry.ts) discards the response, so a 400 here is a silently dropped crash.
 */
const ClientError = z
  .object({
    message: z.string().min(1),
    context: z.unknown().optional(),
  })
  .strict();

/**
 * Collapse control characters (CR/LF included) so a payload cannot forge log lines during an
 * incident, and hard-truncate. Applied to every attacker-controlled string that gets logged.
 */
function oneLine(value: string, max: number): string {
  return value.replace(/\p{Cc}+/gu, " ").slice(0, max);
}

export async function POST(req: Request) {
  try {
    await requireIpRateLimit(clientIpKey(req), "client-error");

    // Cap what we accept before it is parsed — the bound is on the text itself, not on a
    // client-declared content-length header.
    const raw = await req.text();
    if (raw.length > MAX_BODY_CHARS) throw new HttpError(413, "error report too large");

    const body = parseJsonText(raw, ClientError);
    // `context` is free-form by design (lib/sentry.ts passes a caller-supplied bag), so it is
    // serialised, flattened and truncated rather than logged as an object.
    const context =
      body.context === undefined
        ? ""
        : ` context=${oneLine(JSON.stringify(body.context) ?? "", MAX_LOG_CHARS)}`;
    console.error(`[client-error] ${oneLine(body.message, MAX_LOG_CHARS)}${context}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Same contract as withAuth: an error that knows its status is returned verbatim, anything else
    // is a genuine server fault and must keep alerting rather than being swallowed as { ok: true }.
    if (e instanceof HttpError) return e.response;
    throw e;
  }
}
