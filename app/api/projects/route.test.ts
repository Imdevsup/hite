import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

/**
 * Route-level contract tests for /api/projects. Only the Supabase boundary is faked — the REAL
 * `withAuth`, `parseJsonBody` and `dbErrorResponse` run, because the regressions live exactly in
 * how those three compose: a malformed body used to escape withAuth as a Next 500, and a driver
 * error used to hand its Postgres message straight to the client.
 */

interface DbResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

const state: { user: { id: string } | null; result: DbResult } = {
  user: { id: "user-1" },
  result: { data: [], error: null },
};
const inserted: Array<Record<string, unknown>> = [];

/** Chainable, awaitable stand-in for the supabase query builder — only the methods this route uses. */
class FakeQuery implements PromiseLike<DbResult> {
  select(): this { return this; }
  order(): this { return this; }
  insert(row: Record<string, unknown>): this {
    inserted.push(row);
    return this;
  }
  single(): Promise<DbResult> { return Promise.resolve(state.result); }
  then<A = DbResult, B = never>(
    onfulfilled?: ((value: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(state.result).then(onfulfilled, onrejected);
  }
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => new FakeQuery(),
  }),
}));

const { GET, POST } = await import("./route");

const post = (body: string) =>
  new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

beforeEach(() => {
  inserted.length = 0;
  state.user = { id: "user-1" };
  state.result = { data: { id: "p1", title: "Untitled Cut" }, error: null };
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/projects", () => {
  test("creates the project and applies the schema default", async () => {
    const res = (await POST(post(JSON.stringify({})))) as Response;
    expect(res.status).toBe(200);
    expect(inserted[0]).toEqual({ title: "Untitled Cut", owner_user_id: "user-1" });
  });

  test("a malformed body is a 400 naming the field, NOT a 500", async () => {
    const res = (await POST(post(JSON.stringify({ title: "" })))) as Response;
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("title:");
    expect(inserted).toHaveLength(0);
  });

  test("truncated JSON is a 400, not a 500", async () => {
    const res = (await POST(post("{ not json"))) as Response;
    expect(res.status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  test("unauthenticated is still a 401 before anything is parsed", async () => {
    state.user = null;
    const res = (await POST(post("{ not json"))) as Response;
    expect(res.status).toBe(401);
  });
});

describe("GET /api/projects", () => {
  test("returns the rows", async () => {
    state.result = { data: [{ id: "p1", title: "A", updated_at: "now" }], error: null };
    const res = (await GET()) as Response;
    expect(await res.json()).toEqual({ projects: [{ id: "p1", title: "A", updated_at: "now" }] });
  });

  test("a driver error keeps its Postgres message OFF the wire", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    state.result = {
      data: null,
      error: { code: "42501", message: 'permission denied for relation "project"' },
    };
    const res = (await GET()) as Response;
    expect(res.status).toBe(403); // RLS denial, not a 500
    const body = (await res.json()) as { error: string; ref: string };
    expect(body.error).toBe("not allowed");
    expect(JSON.stringify(body)).not.toContain("permission denied");
    expect(String(logged.mock.calls[0][0])).toContain('permission denied for relation "project"');
  });
});
