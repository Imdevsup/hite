import { describe, expect, test, vi, beforeEach } from "vitest";
import { emptyEdl2, type Edl } from "@/lib/edl/schema";

/**
 * Route-level contract test for /api/edits (the editor's manual-edit autosave). The real `withAuth`
 * and `parseJsonBody` run; only Supabase is faked.
 *
 * The regression: the route validated the timeline with a standalone `Edl.parse(body.edl)` whose
 * ZodError escaped `withAuth` as a Next 500, so a corrupt autosave payload read as a server outage
 * instead of naming the broken field. `edl` is now part of the body schema.
 */

const ASSET = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

interface DbResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

const state: { user: { id: string } | null; parent: DbResult; insert: DbResult } = {
  user: { id: "user-1" },
  parent: { data: null, error: null },
  insert: { data: { id: "edit-1", version: 1 }, error: null },
};
const inserted: Array<Record<string, unknown>> = [];

class FakeQuery implements PromiseLike<DbResult> {
  private isInsert = false;
  select(): this { return this; }
  eq(): this { return this; }
  order(): this { return this; }
  limit(): this { return this; }
  insert(row: Record<string, unknown>): this {
    inserted.push(row);
    this.isInsert = true;
    return this;
  }
  single(): Promise<DbResult> { return Promise.resolve(this.isInsert ? state.insert : state.parent); }
  maybeSingle(): Promise<DbResult> { return Promise.resolve(state.parent); }
  then<A = DbResult, B = never>(
    onfulfilled?: ((value: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(state.parent).then(onfulfilled, onrejected);
  }
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => new FakeQuery(),
  }),
}));

const { POST } = await import("./route");

const post = (body: unknown) =>
  new Request("http://localhost/api/edits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const validEdl = (): Edl => emptyEdl2(ASSET, 300_000, "https://blob/clip.mp4");

beforeEach(() => {
  inserted.length = 0;
  state.user = { id: "user-1" };
  state.parent = { data: null, error: null };
  state.insert = { data: { id: "edit-1", version: 1 }, error: null };
});

describe("POST /api/edits", () => {
  test("persists a valid manual edit as the next version", async () => {
    const res = (await POST(post({ projectId: PROJECT, edl: validEdl(), rationale: "split clip" }))) as Response;
    expect(res.status).toBe(200);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].version).toBe(1);
    expect(inserted[0].prompt).toBe("split clip");
  });

  test("a corrupt timeline is a 400 naming the field inside the EDL, not a 500", async () => {
    const broken = validEdl() as unknown as { durationTicks: unknown };
    broken.durationTicks = -1; // Tick.nonnegative()
    const res = (await POST(post({ projectId: PROJECT, edl: broken }))) as Response;
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("edl.durationTicks");
    expect(inserted).toHaveLength(0);
  });

  test("a missing timeline is a 400, not an insert of `undefined`", async () => {
    const res = (await POST(post({ projectId: PROJECT }))) as Response;
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("edl");
    expect(inserted).toHaveLength(0);
  });

  test("a non-uuid projectId is a 400 naming projectId", async () => {
    const res = (await POST(post({ projectId: "undefined", edl: validEdl() }))) as Response;
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("projectId:");
  });
});
