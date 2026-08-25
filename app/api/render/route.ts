import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api/auth";
import { parseJsonBody } from "@/lib/api/body";
import { requireRateLimit } from "@/lib/api/rate-limit";
import { dbErrorResponse } from "@/lib/api/errors";
import { createAdmin } from "@/lib/supabase/admin";
import { enqueueRenderJob } from "@/lib/jobs/queue";
import { resolveExportTier } from "@/lib/jobs/tier";

/**
 * `tier` is deliberately NOT a field here (`tier-client-trusted-watermark-bypass`). It used to be,
 * and `edlToRenderIR` only adds the watermark overlay when the tier is "free", so anyone could
 * `curl -d '{"tier":"pro"}'` for a watermark-free export. It is derived server-side now
 * (lib/jobs/tier.ts). Zod strips the key if a client still sends it — the existing Export window
 * does — so no client change is needed to close the hole.
 */
const Body = z.object({
  projectId: z.string().uuid(),
  aspect: z.enum(["16:9", "9:16", "1:1"]),
});

/**
 * Queue a render of a project's latest edit.
 *
 * Thin: it creates the export row and a job row, and returns their ids. The previous version
 * called `start(renderExportWorkflow, …)`, which threw on every request — so every render click
 * left an orphaned `queued` export row behind AND burned a rate-limit token for work that never
 * started.
 *
 * Order matters here: the edit is checked BEFORE the rate limit is spent, so a click with nothing
 * on the timeline no longer costs the user one of their ten daily renders.
 */
export function POST(req: Request) {
  return withAuth(async ({ user, supabase }) => {
    const body = await parseJsonBody(req, Body);

    const latest = await supabase
      .from("edit")
      .select("id, version")
      .eq("project_id", body.projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) return dbErrorResponse(latest.error);
    if (!latest.data) return NextResponse.json({ error: "no edit to render" }, { status: 400 });

    await requireRateLimit(user.id, "render");

    const admin = createAdmin();
    const { data: inserted, error } = await admin
      .from("export")
      .insert({
        edit_id: latest.data.id,
        aspect: body.aspect,
        tier: resolveExportTier(),
        status: "queued",
      })
      .select("id")
      .single();
    if (error || !inserted) return dbErrorResponse(error ?? { message: "export insert returned no row" });

    const { jobId } = await enqueueRenderJob(admin, inserted.id);
    return NextResponse.json({ exportId: inserted.id, jobId });
  });
}
