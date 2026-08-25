import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { dbErrorResponse, notFoundOrDbError } from "@/lib/api/errors";
import { readRenderJob } from "@/lib/jobs/queue";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Render status — polled by the Export window every 1.5 s.
 *
 * `error` is the point of this route now. The poll had no failure state at all, because a render
 * that died had nowhere to record why: the job row is that place, and its message is written by
 * the worker from the actual ffmpeg/Chromium/storage error (with any signed-url query string
 * stripped first — see worker/errors.ts).
 *
 * `progress` stays a coarse status→number mapping. That is honest: `renderMedia` reports real
 * per-frame progress inside the worker, but nothing persists it per tick, and inventing a
 * percentage the server does not have is exactly what the Export window's indeterminate playhead
 * exists to avoid.
 *
 * `output_blob_url` is deliberately NOT returned. It holds the week-long signed url the worker
 * minted, and a signed url is a bearer credential: shipping it on every 1.5 s tick hands the
 * browser (and anything reading its network log) a key to the finished MP4 that outlives the
 * session by days. The download goes through GET /api/export/[id], which signs a fresh
 * ten-minute url per click from `output_storage_path`.
 */
export function GET(_req: Request, { params }: Ctx) {
  return withAuth(async ({ supabase }) => {
    const { id } = await params;

    const result = await supabase
      .from("export")
      .select("id, status, error, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (result.error) return dbErrorResponse(result.error);
    if (!result.data) return notFoundOrDbError(result);

    const job = await readRenderJob(supabase, id);
    // THE JOB ROW IS THE RUN IDENTITY (migration 006); the export row is where the worker caches
    // the outcome when it gets the chance. It does not always get the chance — a worker killed
    // mid-render, a handler given up on by its deadline, the reaper exhausting the last attempt —
    // and the row is then left saying `running` forever with nothing working on it. Deriving the
    // status here is what turns every one of those into an answer instead of a spinner that never
    // stops. A succeeded export still wins: the file exists, whatever the job row says about it.
    const status =
      result.data.status === "succeeded" ? "succeeded"
      : job?.status === "failed" ? "failed"
      : result.data.status;
    const progress =
      status === "succeeded" ? 1
      : status === "running" ? 0.5
      : status === "failed" ? 0
      : 0.05;

    return NextResponse.json({
      ...result.data,
      status,
      // The export row carries the reason the worker recorded; the job row carries the ones the
      // worker never got to write. Either way the user gets a sentence, never an endless spinner.
      error: result.data.error ?? job?.error ?? null,
      attempts: job?.attempts ?? 0,
      progress,
    });
  });
}
