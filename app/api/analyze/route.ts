import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api/auth";
import { parseJsonBody } from "@/lib/api/body";
import { dbErrorResponse, notFoundOrDbError } from "@/lib/api/errors";
import { createAdmin } from "@/lib/supabase/admin";
import { enqueueAnalyzeJob } from "@/lib/jobs/queue";
import { analysisBranchesForKind } from "@/lib/jobs/types";
import type { AssetKind } from "@/lib/storage/media";

const Body = z.object({
  assetId: z.string().uuid(),
});

/**
 * Queue analysis for an already-persisted asset. (Client flow: upload → POST /api/assets → here.)
 *
 * Thin on purpose: it inserts a job row and returns its id. The previous version called
 * `start(analyzeAssetWorkflow, …)`, which threw on EVERY request because the workflow directives
 * were never compiled — so no transcript, beats or scenes row could ever exist in production.
 *
 * Ownership is enforced by RLS on the select below (the caller's session, not the admin client);
 * only the job INSERT uses the service role, and only after that check has passed.
 */
export function POST(req: Request) {
  return withAuth(async ({ supabase }) => {
    const body = await parseJsonBody(req, Body);

    const asset = await supabase.from("asset").select("id, kind").eq("id", body.assetId).maybeSingle();
    if (asset.error) return dbErrorResponse(asset.error);
    if (!asset.data) return notFoundOrDbError(asset);

    const kind = asset.data.kind as AssetKind;
    const branches = analysisBranchesForKind(kind);
    // A still has no soundtrack and no shot boundaries. Refusing is honest; queueing a job that
    // writes empty rows would report "analysis complete" for work that never happened.
    if (branches.length === 0) {
      return NextResponse.json({ error: `there is nothing to analyze in ${kind} files` }, { status: 400 });
    }

    // The unique index on live analyze jobs makes this idempotent: a second request for an asset
    // already being analyzed joins that job instead of queueing a duplicate pass over the file.
    const { jobId, deduped } = await enqueueAnalyzeJob(createAdmin(), asset.data.id);
    return NextResponse.json({ assetId: asset.data.id, jobId, branches, alreadyRunning: deduped });
  });
}
