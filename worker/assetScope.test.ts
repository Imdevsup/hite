import { describe, expect, test } from "vitest";

/**
 * THE REGRESSION: an export could render another project's footage.
 *
 * `/api/edits` validates the SHAPE of the timeline it is handed (`Edl` in the body schema) and RLS
 * scopes the row it writes to a project the caller owns — but nothing checks that the asset ids
 * INSIDE that timeline belong to that project. The worker then resolved them with the service-role
 * client, which is exempt from RLS:
 *
 *     .from("asset").select(...).in("id", ids)      // ids came from the client's EDL
 *
 * So a project naming another tenant's asset uuid got that tenant's video signed and composited into
 * its own export. It needs a leaked uuid to exploit, which is why this was not rated critical — but
 * the defence must not be "uuids are hard to guess".
 *
 * The fix is one clause. This test pins the SHAPE of the query rather than mocking Supabase's whole
 * builder: what matters is that the project filter is applied before the id filter, and that the
 * project id comes from the EDIT row (server-side) rather than from anything the client sent.
 */
describe("render asset scoping", () => {
  test("loadAssets filters by project_id, not by id alone", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./render.ts", import.meta.url), "utf8"),
    );
    const fn = src.slice(src.indexOf("async function loadAssets"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain('.eq("project_id", projectId)');
    expect(body).toContain('.in("id", ids)');
    // The filter must come first, so an id from another project can never widen the result set.
    expect(body.indexOf('.eq("project_id"')).toBeLessThan(body.indexOf('.in("id"'));
  });

  test("the project id passed in comes from the edit row, never from the EDL", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./render.ts", import.meta.url), "utf8"),
    );
    // `edit.project_id` is read from the database by loadEdit; `edl` is client-supplied.
    expect(src).toContain("loadAssets(ctx.admin, edit.project_id, referencedAssetIds(edl))");
  });
});
