import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { dbErrorResponse, notFoundOrDbError } from "@/lib/api/errors";
import { EXPORTS_BUCKET, createSignedStorageUrl } from "@/lib/storage/media";

type Ctx = { params: Promise<{ id: string }> };

/** Short-lived: this url is handed straight to the browser as a redirect and used immediately. */
const DOWNLOAD_URL_TTL_SECONDS = 60 * 10;

/**
 * Download the rendered MP4.
 *
 * Signs a FRESH url per request from `export.output_storage_path` rather than redirecting to the
 * one stored on the row. A signed url is a bearer credential: the stored one is minted with a
 * week's life so the Export window's download button keeps working, and re-signing here means this
 * link never goes stale AND the credential handed out lives for ten minutes instead of a week.
 *
 * The signing runs on the CALLER's session, not the admin client, so storage RLS re-checks that
 * the object is under their own `{userId}/` prefix — ownership is proven twice, by the export row
 * policy and by the storage policy.
 */
export function GET(_req: Request, { params }: Ctx) {
  return withAuth(async ({ supabase }) => {
    const { id } = await params;

    const result = await supabase
      .from("export")
      .select("status, error, output_storage_path, output_blob_url")
      .eq("id", id)
      .maybeSingle();
    if (result.error) return dbErrorResponse(result.error);
    if (!result.data) return notFoundOrDbError(result);

    const { status, error, output_storage_path, output_blob_url } = result.data;
    // Say WHY it is not downloadable. "not ready" for a render that failed an hour ago is the same
    // silence the whole unit is removing.
    if (status === "failed") {
      return NextResponse.json({ error: error ?? "the render failed" }, { status: 409 });
    }
    if (status !== "succeeded") {
      return NextResponse.json({ error: `the render is ${status}` }, { status: 409 });
    }

    if (output_storage_path) {
      const url = await createSignedStorageUrl(supabase, EXPORTS_BUCKET, output_storage_path, DOWNLOAD_URL_TTL_SECONDS);
      return NextResponse.redirect(url);
    }
    // Rows rendered before migration 006 have no storage path, only the url the worker stored.
    if (output_blob_url) return NextResponse.redirect(output_blob_url);
    return NextResponse.json({ error: "this export succeeded but no file was recorded for it" }, { status: 500 });
  });
}
