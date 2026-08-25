import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EditorShell } from "./_components/EditorShell";
import { Edl, type Edl as EdlType } from "@/lib/edl/schema";
import { upgradeEdlV1toV2 } from "@/lib/edl/migrate";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ projectId: string }>;
  /**
   * The landing's `?prompt=` deep link.
   *
   * Read HERE rather than with `useSearchParams()` inside the composer. The composer is the one field
   * a referred visitor lands in, and a client hook cannot know the URL during the server render — so
   * the old shape needed an effect, a one-shot ref and a lint suppression to avoid a hydration
   * mismatch on exactly that path. A server component already has the value; handing it down as
   * initial state makes the server HTML and the first client paint identical by construction.
   */
  searchParams: Promise<{ prompt?: string | string[] }>;
};

export default async function ProjectEditor({ params, searchParams }: Props) {
  const { projectId } = await params;
  const { prompt } = await searchParams;
  const supabase = await createClient();
  // `window_layout` is no longer selected: the eleven floating windows it positioned are deleted
  // (ART-DIRECTION §13), so the column is dead weight on every editor load. The COLUMN still exists —
  // dropping it is a migration, not a UI change — but nothing reads it any more.
  const { data: project } = await supabase
    .from("project")
    .select("id, title")
    .eq("id", projectId)
    .single();

  if (!project) notFound();

  const [{ data: assets }, { data: latestEdit }] = await Promise.all([
    supabase
      .from("asset")
      .select("id, kind, blob_url, filename, duration_ms, width, height, fps")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("edit")
      .select("edl, version")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const version: number | null = typeof latestEdit?.version === "number" ? latestEdit.version : null;
  const loaded = asEdl2(latestEdit?.edl, version, projectId);

  return (
    <EditorShell
      project={project}
      initialAssets={assets ?? []}
      initialEdl={loaded.edl}
      initialEdlError={loaded.error}
      initialPrompt={typeof prompt === "string" ? prompt : undefined}
    />
  );
}

/**
 * Normalize a persisted edit to Edl.2 on the server (migrate v1, validate v2).
 *
 * A row that exists but won't parse is a REPORTED failure, not a silent null: returning null alone
 * made the editor open as if the project had never been edited, and its next autosave buried the
 * good version under a fresh one. The message rides along to the store, which blocks autosave while
 * it is set.
 */
function asEdl2(
  raw: unknown,
  version: number | null,
  projectId: string,
): { edl: EdlType | null; error: string | null } {
  if (raw === null || raw === undefined) return { edl: null, error: null }; // no saved edit yet — normal
  const label = version === null ? "your last saved edit" : `your last saved edit (v${version})`;
  const fail = (detail: string) => {
    console.error(`[editor] project ${projectId}: couldn't load ${label} —`, detail);
    return { edl: null, error: `couldn't load ${label}` };
  };
  if (typeof raw !== "object") return fail(`the stored edl is a ${typeof raw}, not an object`);
  try {
    const edl = (raw as { schema?: string }).schema === "Edl.2" ? Edl.parse(raw) : upgradeEdlV1toV2(raw);
    return { edl, error: null };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
