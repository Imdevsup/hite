import { describe, it, expect, vi, beforeEach } from "vitest";
import { emptyEdl2, type Edl } from "@/lib/edl/schema";
import { PlannerRun } from "@/lib/ai/agents/critique";
import type { EFFORT } from "@/lib/ai/effort";

/**
 * Route-level contract tests for /api/refine — parity with app/api/plan/route.test.ts (the same
 * regressions: the no-op emit, two emits in one step, real asset durations reaching the reducer, a
 * 400 with field names, the validated-and-clamped effort level, and the BYOK key never leaking).
 * Only the boundary is faked.
 */

const ASSET = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const EDIT = "33333333-3333-4333-8333-333333333333";
const SENTINEL_KEY = "AIzaSy-sentinel-visitor-key-0000";

type Row = Record<string, unknown>;
interface DbResult {
  data: unknown;
  error: null;
}

/** Chainable, awaitable stand-in for the supabase query builder — only the methods this route uses. */
class FakeQuery implements PromiseLike<DbResult> {
  constructor(
    private readonly result: DbResult,
    private readonly onInsert?: (row: Row) => void,
  ) {}
  select(): this { return this; }
  eq(): this { return this; }
  insert(row: Row): this {
    this.onInsert?.(row);
    return this;
  }
  single(): Promise<DbResult> { return Promise.resolve(this.result); }
  then<A = DbResult, B = never>(
    onfulfilled?: ((value: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

interface Fixture {
  assets: Array<{ id: string; filename: string; duration_ms: number | null }>;
  parentEdl: Edl;
}
const fixture: Fixture = { assets: [], parentEdl: emptyEdl2(ASSET, 300_000) };
const insertedEdits: Row[] = [];

const { runPlannerMock } = vi.hoisted(() => ({
  runPlannerMock: vi.fn(),
}));

vi.mock("@/lib/ai/agents/planner", () => ({ runPlanner: runPlannerMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdmin: () => ({
    from: () => new FakeQuery({ data: { id: "edit-new" }, error: null }, (row) => insertedEdits.push(row)),
  }),
}));
// The rate-limit gate the route now calls — /api/refine ran the same Gemini tool-loop as /api/plan
// with no cap at all, so the plan bucket was bypassable by refining forever.
const requireRateLimitMock = vi.fn();
vi.mock("@/lib/api/rate-limit", () => ({ requireRateLimit: requireRateLimitMock }));
// Mirrors the real withAuth: an HttpError (401/400/429) becomes its response; anything else throws.
vi.mock("@/lib/api/auth", async () => {
  const { HttpError } = await import("@/lib/api/errors");
  return {
    withAuth: async (handler: (ctx: { user: { id: string }; supabase: { from: (t: string) => FakeQuery } }) => unknown) => {
      try {
        return await handler({
          user: { id: "user-1" },
          supabase: {
            from: (table: string) =>
              table === "asset"
                ? new FakeQuery({ data: fixture.assets, error: null })
                : new FakeQuery({ data: { id: EDIT, project_id: PROJECT, version: 1, edl: fixture.parentEdl }, error: null }),
          },
        });
      } catch (e) {
        if (e instanceof HttpError) return e.response;
        throw e;
      }
    },
  };
});

const { POST } = await import("./route");

type StreamPart =
  | { type: "text-delta"; text: string }
  | { type: "start-step" }
  | { type: "tool-call"; toolName: string; input: unknown }
  | { type: "finish"; totalUsage: { totalTokens: number } };

interface PlannerCall {
  parentSummary: string;
  prompt: string;
  effort: (typeof EFFORT)[keyof typeof EFFORT];
  selection: { providerId: string; model: string; surface: string | null; baseUrl: string | null };
  credential: { kind: string; key?: string };
  parentEdl: Edl;
  assetDurationsTicks: Record<string, number>;
}
let lastPlannerCall: PlannerCall | null = null;

interface RunOptions {
  body?: unknown;
  headers?: Record<string, string>;
  fail?: Error;
  /** Whether the emit tool's `execute` ran, as the SDK does above draft effort. */
  executeEmit?: boolean;
}

async function run(parts: StreamPart[], options: RunOptions = {}) {
  const body = options.body ?? { editId: EDIT, prompt: "tweak it" };
  runPlannerMock.mockImplementation((opts: PlannerCall) => {
    lastPlannerCall = opts;
    const plannerRun = new PlannerRun({
      effort: opts.effort,
      parentEdl: opts.parentEdl,
      assetDurationsTicks: opts.assetDurationsTicks,
      prompt: opts.prompt,
    });
    return {
      run: plannerRun,
      stream: {
        fullStream: (async function* () {
          for (const p of parts) {
            yield p;
            if (options.executeEmit && p.type === "tool-call" && p.toolName === "emitEditBatch") {
              plannerRun.dryRun(p.input);
            }
          }
          if (options.fail) throw options.fail;
        })(),
      },
    };
  });
  const res = await POST(
    new Request("http://localhost/api/refine", {
      method: "POST",
      headers: {
        // BYOK is the only path: without a key every request here would be a 402 rather than the
        // thing the test names. `headers` overrides it for the credential cases.
        "content-type": "application/json",
        "x-hite-provider-key": SENTINEL_KEY,
        ...(options.headers ?? {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  return res as Response;
}

async function sseEvents(res: Response): Promise<Array<{ type: string; data?: unknown }>> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((chunk) => chunk.replace(/^data: /, "").trim())
    .filter((line) => line.length > 0 && line !== "[DONE]")
    .map((line) => JSON.parse(line) as { type: string; data?: unknown });
}

const emit = (input: unknown): StreamPart => ({ type: "tool-call", toolName: "emitEditBatch", input });
const types = (events: Array<{ type: string }>) => events.map((e) => e.type);

beforeEach(() => {
  insertedEdits.length = 0;
  lastPlannerCall = null;
  runPlannerMock.mockReset();
  requireRateLimitMock.mockReset().mockResolvedValue(undefined);
  fixture.assets = [{ id: ASSET, filename: "clip.mp4", duration_ms: 30_000 }];
  fixture.parentEdl = emptyEdl2(ASSET, 300_000, "https://blob/clip.mp4"); // 10s of a 30s asset
});

describe("POST /api/refine", () => {
  it("a zero-command emit is a valid no-op turn: summary + marker, nothing persisted", async () => {
    const events = await sseEvents(await run([emit({ commands: [], summary: "That's already how it's cut." })]));
    expect(types(events)).toEqual(["effort", "summary", "no-op"]);
    expect(events[1].data).toBe("That's already how it's cut.");
    expect(insertedEdits).toHaveLength(0);
  });

  it("two emits in ONE step fail the turn instead of silently applying only the last one", async () => {
    const events = await sseEvents(
      await run([
        emit({ commands: [{ type: "ADD_MARKER", atTick: 0, title: "a" }], summary: "a" }),
        emit({ commands: [{ type: "ADD_MARKER", atTick: 1, title: "b" }], summary: "b" }),
      ]),
    );
    expect((events.find((e) => e.type === "error")?.data as { message: string }).message)
      .toBe("planner emitted multiple edit batches");
    expect(insertedEdits).toHaveLength(0);
  });

  it("passes real asset durations to the reducer, so a minted clip can still be extended later", async () => {
    const events = await sseEvents(
      await run([
        emit({
          commands: [{ type: "ADD_CLIP", assetId: ASSET, trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 150_000 }],
          summary: "appended a 5s clip",
        }),
      ]),
    );
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(insertedEdits).toHaveLength(1);
    const edl = insertedEdits[0].edl as Edl;
    const clips = edl.tracks[0].items.filter((i): i is Extract<typeof i, { schema: "Clip.1" }> => i.schema === "Clip.1");
    expect(clips[1].mediaRefs.full.availableOutTick).toBe(900_000);
  });

  it("summarises the timeline in ticks with ms in parentheses", async () => {
    await sseEvents(await run([emit({ commands: [{ type: "ADD_MARKER", atTick: 0, title: "x" }], summary: "marked" })]));
    expect(lastPlannerCall?.parentSummary).toContain("timeline=[0..300000]t (0..10000ms)");
  });

  it("is metered on its own bucket — over the cap it 429s WITHOUT starting a Gemini run", async () => {
    // Regression: refine had no rate limit at all, so one plan + a loop of refines was unbounded
    // spend on the shared GEMINI_API_KEYS pool. The gate must fire before runPlanner, not after.
    const { HttpError } = await import("@/lib/api/errors");
    requireRateLimitMock.mockRejectedValue(new HttpError(429, "daily limit reached"));
    const res = await run([emit({ commands: [], summary: "x" })]);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily limit reached" });
    expect(requireRateLimitMock).toHaveBeenCalledWith("user-1", "refine");
    expect(runPlannerMock).not.toHaveBeenCalled();
  });

  it("a malformed body is a 400 with field-named issues, not a 500", async () => {
    const bad = await run([], { body: { editId: "nope", prompt: "" } });
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: string };
    expect(body.error).toContain("editId:");
    expect(body.error).not.toContain('[{"');

    expect((await run([], { body: "{ not json" })).status).toBe(400);
  });
});

describe("effort and the credential, in parity with /api/plan", () => {
  it("an absent level runs the ladder's one default and reports it", async () => {
    // One payer, one default: the user pays their own provider directly.
    const events = await sseEvents(await run([emit({ commands: [], summary: "x" })]));
    expect(events[0]).toMatchObject({ type: "effort", data: { level: "high", requested: null } });
  });

  it("an UNKNOWN level is a 400 naming the field, never a silent downgrade", async () => {
    const res = await run([], { body: { editId: EDIT, prompt: "x", effort: "turbo" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("effort:");
    expect(runPlannerMock).not.toHaveBeenCalled();
  });

  it("the deployer's brake clamps a max request", async () => {
    vi.stubEnv("HITE_BYOK_EFFORT_CEILING", "standard");
    await run([emit({ commands: [], summary: "x" })], { body: { editId: EDIT, prompt: "x", effort: "max" } });
    expect(lastPlannerCall?.effort.level).toBe("standard");
    vi.unstubAllEnvs();
  });

  it("the caller's own key reaches the planner, at the ladder's default rung", async () => {
    await run([emit({ commands: [], summary: "x" })]);
    expect(lastPlannerCall?.effort.level).toBe("high");
    expect(lastPlannerCall?.credential).toEqual({ kind: "byok", key: SENTINEL_KEY });
  });

  it("no key is a 402 pointing at settings — there is no pool to fall back to", async () => {
    const res = await run([emit({ commands: [], summary: "x" })], { headers: { "x-hite-provider-key": "" } });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "add your own provider API key in settings to continue" });
  });

  it("the key appears in NO SSE frame, even when the provider echoes it back", async () => {
    const events = await sseEvents(
      await run([], {
        headers: { "x-hite-provider-key": SENTINEL_KEY },
        fail: new Error(`API key ${SENTINEL_KEY} is not authorized`),
      }),
    );
    expect(JSON.stringify(events)).not.toContain(SENTINEL_KEY);
  });

  it("a validated batch survives a fault on a later round — the turn is not lost", async () => {
    const events = await sseEvents(
      await run([{ type: "start-step" }, emit({ commands: [{ type: "ADD_MARKER", atTick: 0, title: "kept" }], summary: "kept" })], {
        executeEmit: true,
        fail: new Error("planner stream aborted"),
      }),
    );
    expect(types(events)).toContain("warning");
    expect(insertedEdits).toHaveLength(1);
  });
});
