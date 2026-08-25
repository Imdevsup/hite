import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { parseJsonBody } from "@/lib/api/body";
import { dbErrorResponse } from "@/lib/api/errors";
import { Edl } from "@/lib/edl/schema";
import { z } from "zod";

// `edl` is validated as part of the body, not by a second `Edl.parse` afterwards: a bad timeline is
// the same class of failure as a bad projectId, and the standalone parse threw a raw ZodError that
// escaped withAuth as a 500. Composed here, a broken clip reads as `edl.tracks.0.items.2.outTick: …`.
const Body = z.object({
  projectId: z.string().uuid(),
  edl: Edl,
  rationale: z.string().max(1000).optional(),
});

/**
 * Persist a manual edit (not AI-generated). Called by the editor store's
 * debounced autosave when the user splits, trims, reorders, or ripple-
 * deletes clips.
 *
 * Appends a new edit row with parent_edit_id = the latest edit, so the
 * undo chain mirrors AI-driven edits. RLS handles authorization.
 */
export function POST(req: Request) {
  return withAuth(async ({ supabase }) => {
    const body = await parseJsonBody(req, Body);

    const { data: parent } = await supabase
      .from("edit")
      .select("id, version")
      .eq("project_id", body.projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await supabase
      .from("edit")
      .insert({
        project_id: body.projectId,
        version: (parent?.version ?? 0) + 1,
        parent_edit_id: parent?.id ?? null,
        prompt: body.rationale ?? "manual timeline edit",
        edl: body.edl,
      })
      .select("id, version")
      .single();
    if (error) return dbErrorResponse(error);
    return NextResponse.json(data);
  });
}
