import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { dbErrorResponse, notFoundOrDbError } from "@/lib/api/errors";
import { readAnalyzeJob } from "@/lib/jobs/queue";
import { analysisBranchesForKind } from "@/lib/jobs/types";
import type { AssetKind } from "@/lib/storage/media";

type Ctx = { params: Promise<{ assetId: string }> };

/**
 * Analysis progress — polled by the Media window.
 *
 * Two things this fixes.
 *
 * `silent-degradation-no-failure-state`: the client polled every 1.5 s FOREVER, with no timeout and
 * no error state, because the database had nowhere to record a failure. The `job` row is that
 * place, so this returns a real `status` and a human-readable `error` alongside the finished
 * branches, and the UI can say "failed: GROQ_API_KEY is not set" instead of spinning.
 *
 * `poll-payload-ships-full-analysis-blobs`: it used to `select("kind, data, created_at")` and ship
 * every analysis blob on every 1.5 s tick. A transcript with word timings is hundreds of KB. Only
 * the branch NAMES travel now; the blobs are read once, by the tool that needs them.
 */
export function GET(_req: Request, { params }: Ctx) {
  return withAuth(async ({ supabase }) => {
    const { assetId } = await params;

    const asset = await supabase
      .from("asset")
      .select("id, kind, duration_ms, width, height, fps")
      .eq("id", assetId)
      .maybeSingle();
    if (asset.error) return dbErrorResponse(asset.error);
    if (!asset.data) return notFoundOrDbError(asset);

    const [analyses, transcript, job] = await Promise.all([
      supabase.from("analysis").select("kind").eq("asset_id", assetId),
      supabase.from("transcript").select("id").eq("asset_id", assetId).maybeSingle(),
      readAnalyzeJob(supabase, assetId),
    ]);
    if (analyses.error) return dbErrorResponse(analyses.error);
    if (transcript.error) return dbErrorResponse(transcript.error);

    const done = new Set<string>((analyses.data ?? []).map((row) => row.kind as string));
    if (transcript.data) done.add("transcribe");

    // The DENOMINATOR the UI counts against, derived from what this asset can actually have —
    // audio assets have no shot boundaries, and no asset has faces (that pipeline is cut).
    const branches = analysisBranchesForKind(asset.data.kind as AssetKind);

    return NextResponse.json({
      assetId,
      asset: asset.data,
      branches,
      done: branches.filter((branch) => done.has(branch)),
      // `null` means analysis was never requested for this asset — distinct from "queued".
      status: job?.status ?? null,
      error: job?.error ?? null,
    });
  });
}
