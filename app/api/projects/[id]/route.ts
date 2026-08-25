import { NextResponse } from "next/server";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { withAuth } from "@/lib/api/auth";
import { parseJsonBody } from "@/lib/api/body";
import { dbErrorResponse } from "@/lib/api/errors";
import { EXPORTS_BUCKET, MEDIA_BUCKET, removeStorageObjects } from "@/lib/storage/media";
import { z } from "zod";

// The single updatable field is optional, so an empty body would reach PostgREST as an empty UPDATE
// payload — which it rejects, surfacing as a 500. Require the field here so "nothing to update" is
// a 400 that names it.
const Patch = z
  .object({ title: z.string().min(1).max(120).optional() })
  .refine((b) => b.title !== undefined, {
    message: "provide at least one field to update",
    path: ["title"],
  });

type Ctx = { params: Promise<{ id: string }> };

export function GET(_req: Request, { params }: Ctx) {
  return withAuth(async ({ supabase }) => {
    const { id } = await params;
    const { data, error } = await supabase
      .from("project")
      .select("id, title, window_layout, updated_at")
      .eq("id", id)
      .single();
    // .single() yields PGRST116 (→404) for a missing row; 42501/PGRST301 (→403) for an RLS denial;
    // anything else is a real fault (→500). Previously every error was masked as 404.
    if (error) return dbErrorResponse(error);
    return NextResponse.json(data);
  });
}

export function PATCH(req: Request, { params }: Ctx) {
  return withAuth(async ({ supabase }) => {
    const { id } = await params;
    // 400 with the offending field, not a Next 500 — see lib/api/body.ts.
    const body = await parseJsonBody(req, Patch);
    const { data, error } = await supabase
      .from("project")
      .update(body)
      .eq("id", id)
      .select()
      .single();
    if (error) return dbErrorResponse(error);
    return NextResponse.json(data);
  });
}

/**
 * Delete a project — its rows AND the bytes they point at.
 *
 * `on delete cascade` takes the asset/edit/export rows with the project, and those rows are the
 * only record of which storage objects belonged to it. Storage has no cascade, so this used to
 * leave every uploaded clip and every rendered MP4 in the buckets permanently, referenced by
 * nothing and reachable by nobody. The keys are therefore read BEFORE the delete, and the objects
 * removed after: rows first means a storage failure can only ever leave an orphan (what happened
 * every time before), never a live project whose footage is gone.
 */
export function DELETE(_req: Request, { params }: Ctx) {
  return withAuth(async ({ supabase }) => {
    const { id } = await params;

    // If the keys cannot be read, stop: deleting now would orphan the bytes with nothing left
    // pointing at them, which is the failure being fixed. A retry costs the user one click.
    const objects = await projectObjectKeys(supabase, id);
    if (objects.error) return dbErrorResponse(objects.error);

    const { error } = await supabase.from("project").delete().eq("id", id);
    if (error) return dbErrorResponse(error);

    const outcomes = [
      await removeStorageObjects(supabase, MEDIA_BUCKET, objects.media),
      await removeStorageObjects(supabase, EXPORTS_BUCKET, objects.exports),
    ];
    // Best-effort by design, but never silent: an orphan nobody logged is an orphan nobody sweeps.
    const problems = outcomes.map((o) => o.error).filter((e): e is string => e !== null);
    if (problems.length > 0) console.error(`[projects] project ${id} deleted, storage not fully cleaned: ${problems.join("; ")}`);

    return NextResponse.json({ ok: true, objectsRemoved: outcomes.reduce((sum, o) => sum + o.removed, 0) });
  });
}

/**
 * Every storage key this project owns, read under the CALLER's session so RLS is what proves the
 * objects are theirs to delete. Rows created before migration 005/006 have no key and are skipped —
 * their bytes live in a Vercel Blob store this build no longer talks to.
 */
async function projectObjectKeys(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ media: string[]; exports: string[]; error: PostgrestError | null }> {
  const empty = { media: [], exports: [] };

  const assets = await supabase.from("asset").select("storage_path").eq("project_id", projectId);
  if (assets.error) return { ...empty, error: assets.error };

  const edits = await supabase.from("edit").select("id").eq("project_id", projectId);
  if (edits.error) return { ...empty, error: edits.error };
  const editIds = (edits.data ?? []).map((row) => row.id as string);

  const exports = editIds.length
    ? await supabase.from("export").select("output_storage_path").in("edit_id", editIds)
    : { data: [] as Record<string, unknown>[], error: null };
  if (exports.error) return { ...empty, error: exports.error };

  return {
    media: keys(assets.data, "storage_path"),
    exports: keys(exports.data, "output_storage_path"),
    error: null,
  };
}

function keys(rows: Record<string, unknown>[] | null, column: string): string[] {
  return (rows ?? []).map((row) => row[column]).filter((v): v is string => typeof v === "string" && v.length > 0);
}
