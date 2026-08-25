import { describe, it, expect, vi, beforeEach } from "vitest";
import { emptyEdl2, type Edl } from "@/lib/edl/schema";
import { PlannerRun } from "@/lib/ai/agents/critique";
import { EFFORT } from "@/lib/ai/effort";

/**
 * Route-level contract tests for /api/plan.
 *
 * Only the BOUNDARY is faked (auth, Supabase, the model stream) — the flat mapper, the reducer, the
 * dry run and the SSE orchestration are the real thing, because those are what these regressions
 * live in: a zero-command emit must be a valid no-op turn, two emits in ONE step must fail loudly,
 * real asset durations must reach the reducer, a malformed body must be a 400 with field names, the
 * effort level must be validated and clamped server-side, and a visitor's API key must never appear
 * in anything the client can read.
 */

const ASSET = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const SENTINEL_KEY = "AIzaSy-sentinel-visitor-key-0000";

type Row = Record<string, unknown>;
interface DbResult {
  data: unknown;
  error: null;
}

/** Chainable, awaitable stand-in for the supabase query builder — only the methods these routes use. */
class FakeQuery implements PromiseLike<DbResult> {
  constructor(
    private readonly result: DbResult,
    private readonly onInsert?: (row: Row) => void,
  ) {}
  select(): this { return this; }
  eq(): this { return this; }
  order(): this { return this; }
  limit(): this { return this; }
  insert(row: Row): this {
    this.onInsert?.(row);
    return this;
  }
  single(): Promise<DbResult> { return Promise.resolve(this.result); }
  maybeSingle(): Promise<DbResult> { return Promise.resolve(this.result); }
  then<A = DbResult, B = never>(
    onfulfilled?: ((value: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

interface Fixture {
  assets: Array<{ id: string; filename: string; duration_ms: number | null; blob_url: string | null }>;
  parentEdl: Edl | null;
}
const fixture: Fixture = { assets: [], parentEdl: null };
const insertedEdits: Row[] = [];

const { runPlannerMock } = vi.hoisted(() => ({ runPlannerMock: vi.fn() }));

vi.mock("@/lib/ai/agents/planner", () => ({ runPlanner: runPlannerMock }));
// NOTHING about the provider layer is faked: the header parsing, the provider/model resolution, the
// 402 for a keyless request and the redaction are all part of this route's contract.
// The shared spend gate (lib/api/rate-limit.ts) — /api/plan open-coded checkRateLimit + its own 429.
const requireRateLimitMock = vi.fn();
vi.mock("@/lib/api/rate-limit", () => ({ requireRateLimit: requireRateLimitMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdmin: () => ({
    from: () => new FakeQuery({ data: { id: "edit-new" }, error: null }, (row) => insertedEdits.push(row)),
  }),
}));
// Mirrors the real withAuth: an HttpError (401/400/429) becomes its response; anything else throws.
// The route's 400s and 429s are thrown now, so a pass-through mock would report them as rejections.
vi.mock("@/lib/api/auth", async () => {
  const { HttpError } = await import("@/lib/api/errors");
  return {
    withAuth: async (
      handler: (ctx: { user: { id: string }; supabase: { from: (t: string) => FakeQuery } }) => unknown,
    ) => {
      try {
        return await handler({
          user: { id: "user-1" },
          supabase: {
            from: (table: string) => {
              if (table === "project") return new FakeQuery({ data: { id: PROJECT }, error: null });
              if (table === "asset") return new FakeQuery({ data: fixture.assets, error: null });
              return new FakeQuery({
                data: fixture.parentEdl ? { id: "edit-1", version: 1, edl: fixture.parentEdl } : null,
                error: null,
              });
            },
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
  /** Thrown while the route walks the stream, to exercise the failure paths. */
  fail?: Error;
  /**
   * Whether the emit tool's `execute` ran, as the SDK would. Both shapes are real: above draft the
   * tool executes and the route persists `run.lastValid`; at draft the loop stops on the tool CALL,
   * and the route's post-loop safety net does the one and only dry run. Default false, so the
   * existing regressions keep exercising the net.
   */
  executeEmit?: boolean;
}

/** Drive the route with a scripted model stream and return the raw Response. */
async function run(parts: StreamPart[], options: RunOptions = {}) {
  const body = options.body ?? { projectId: PROJECT, prompt: "do the thing" };
  runPlannerMock.mockImplementation((opts: PlannerCall) => {
    lastPlannerCall = opts;
    // A REAL PlannerRun: the route's persist path reads `run.lastValid`, so faking it would fake
    // exactly the thing under test.
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
            // The SDK executes a tool AFTER its call part is streamed; mirror that ordering so the
            // route sees `run.lastValid` exactly when it would in production.
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
    new Request("http://localhost/api/plan", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // BYOK is the only path, so a request without a key is a 402. Every test that is not ABOUT
        // the credential carries one; `headers` can override it to exercise the missing/bad cases.
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
  runPlannerMock.mockReset(); // `run()` re-arms it; without this "was never called" leaks across tests
  requireRateLimitMock.mockReset().mockResolvedValue(undefined);
  fixture.assets = [{ id: ASSET, filename: "clip.mp4", duration_ms: 30_000, blob_url: "https://blob/clip.mp4" }];
  fixture.parentEdl = emptyEdl2(ASSET, 300_000, "https://blob/clip.mp4"); // 10s of a 30s asset
});

describe("POST /api/plan", () => {
  it("a zero-command emit is a valid no-op turn: summary + marker, nothing persisted", async () => {
    // The system prompt tells the model to answer an impossible/empty request exactly this way; the
    // mapper's 'planner emitted an empty edit batch' used to surface as an SSE error instead.
    const events = await sseEvents(
      await run([emit({ commands: [], summary: "Nothing to cut — the timeline is empty." })]),
    );
    expect(types(events)).toEqual(["effort", "summary", "no-op"]);
    expect(events[1].data).toBe("Nothing to cut — the timeline is empty.");
    expect(insertedEdits).toHaveLength(0);
  });

  it("two emits in ONE step fail the turn instead of silently applying only the last one", async () => {
    const events = await sseEvents(
      await run([
        emit({ commands: [{ type: "REMOVE_CLIP", clipId: "c0" }], summary: "first half" }),
        emit({ commands: [{ type: "ADD_MARKER", atTick: 0, title: "second half" }], summary: "second half" }),
      ]),
    );
    const error = events.find((e) => e.type === "error");
    expect((error?.data as { message: string }).message).toBe("planner emitted multiple edit batches");
    expect(events.some((e) => e.type === "edl")).toBe(false);
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
    // duration_ms 30000 × 30 = 900000 ticks of REAL media; without the durations map the minted clip
    // would be bounded by its own out point (150000) and "extend it by 2s" would be a silent no-op.
    expect(clips[1].mediaRefs.full.availableOutTick).toBe(900_000);
  });

  it("summarises the timeline in ticks with ms in parentheses (one unit for reading and writing)", async () => {
    await sseEvents(await run([emit({ commands: [{ type: "ADD_MARKER", atTick: 0, title: "x" }], summary: "marked" })]));
    expect(lastPlannerCall?.parentSummary).toContain("timeline=[0..300000]t (0..10000ms)");
    expect(lastPlannerCall?.parentSummary).toContain("duration=300000t (10000ms)");
  });

  it("a ZodError inside the stream reaches the chat as field-named lines, not a JSON blob", async () => {
    // e.g. the model emits a batch that doesn't satisfy the flat schema at all; `.message` on a
    // ZodError is the raw issues array, which used to be sent to the user verbatim.
    const events = await sseEvents(await run([emit({ commands: [], summary: 5 })]));
    const message = (events.find((e) => e.type === "error")?.data as { message: string }).message;
    expect(message).toContain("summary:");
    expect(message).not.toContain('[{"');
    expect(insertedEdits).toHaveLength(0);
  });

  it("meters through the shared gate — over the cap it 429s WITHOUT starting a Gemini run", async () => {
    // The gate was open-coded here (checkRateLimit + a hand-written 429) while /api/refine used the
    // helper, so the two routes could drift apart on wording and on ordering. One owner, and it must
    // fire before runPlanner.
    const { HttpError } = await import("@/lib/api/errors");
    requireRateLimitMock.mockRejectedValue(new HttpError(429, "daily limit reached"));
    const res = await run([emit({ commands: [], summary: "x" })]);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily limit reached" });
    expect(requireRateLimitMock).toHaveBeenCalledWith("user-1", "plan");
    expect(runPlannerMock).not.toHaveBeenCalled();
  });

  it("a malformed body is a 400 with field-named issues, not a 500 or a ZodError JSON blob", async () => {
    const bad = await run([], { body: { projectId: "undefined", prompt: "" } });
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: string };
    expect(body.error).toContain("projectId:");
    expect(body.error).toContain("prompt:");
    expect(body.error).not.toContain('[{"');

    const invalidJson = await run([], { body: "{ not json" });
    expect(invalidJson.status).toBe(400);
  });
});

describe("effort arrives per request and is never trusted raw", () => {
  it("an absent level runs the ladder's one default and says so on the stream", async () => {
    // There is one payer now, so there is one default: the user pays their own provider directly.
    const events = await sseEvents(await run([emit({ commands: [], summary: "x" })]));
    expect(events[0]).toMatchObject({ type: "effort", data: { level: "high", requested: null } });
    expect(lastPlannerCall?.effort.level).toBe("high");
  });

  it("an UNKNOWN level is a 400 naming the field — never a silent downgrade", async () => {
    const res = await run([], { body: { projectId: PROJECT, prompt: "x", effort: "ultra" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("effort:");
    expect(runPlannerMock).not.toHaveBeenCalled();
  });

  it("a level ABOVE the deployer's brake is clamped server-side and reported back", async () => {
    // The client asked for max; the operator capped function-seconds at standard. It gets standard,
    // and it is TOLD so rather than being quietly given a cheaper turn while its UI claims max.
    vi.stubEnv("HITE_BYOK_EFFORT_CEILING", "standard");
    const events = await sseEvents(
      await run([emit({ commands: [], summary: "x" })], { body: { projectId: PROJECT, prompt: "x", effort: "max" } }),
    );
    expect(events[0].data).toMatchObject({ level: "standard", requested: "max" });
    expect(lastPlannerCall?.effort.level).toBe("standard");
    vi.unstubAllEnvs();
  });

  it("a level below the ceiling is honoured", async () => {
    await run([emit({ commands: [], summary: "x" })], { body: { projectId: PROJECT, prompt: "x", effort: "draft" } });
    expect(lastPlannerCall?.effort.level).toBe("draft");
    expect(lastPlannerCall?.effort.thinking).toBe("off");
  });

  it("the planner is handed the parent timeline and real durations, so the dry run is real", async () => {
    await run([emit({ commands: [], summary: "x" })]);
    expect(lastPlannerCall?.parentEdl.schema).toBe("Edl.2");
    expect(lastPlannerCall?.assetDurationsTicks).toEqual({ [ASSET]: 900_000 });
  });
});

describe("bring-your-own-key is the only path", () => {
  const byok = { "x-hite-provider-key": SENTINEL_KEY };

  it("the caller's key reaches the planner, and their default rung is the good one", async () => {
    const events = await sseEvents(await run([emit({ commands: [], summary: "x" })], { headers: byok }));
    expect(events[0].data).toMatchObject({ level: "high", provider: "google", model: "gemini-2.5-flash" });
    expect(lastPlannerCall?.credential).toEqual({ kind: "byok", key: SENTINEL_KEY });
  });

  it("the caller reaches max — the cost is theirs and no deployer brake is set", async () => {
    await run([emit({ commands: [], summary: "x" })], {
      headers: byok,
      body: { projectId: PROJECT, prompt: "x", effort: "max" },
    });
    expect(lastPlannerCall?.effort.level).toBe("max");
  });

  it("NO key is a 402 pointing at settings — never a fallback onto somebody else's credential", async () => {
    // The pool is gone. A keyless request used to run on the deployer's `GEMINI_API_KEYS`; setting
    // that variable must now change nothing at all here.
    vi.stubEnv("GEMINI_API_KEYS", "deployer-key-a,deployer-key-b");
    const res = await run([emit({ commands: [], summary: "x" })], { headers: { "x-hite-provider-key": "" } });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "add your own provider API key in settings to continue" });
    expect(runPlannerMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("the caller picks the provider and the model, and both reach the planner", async () => {
    await run([emit({ commands: [], summary: "x" })], {
      headers: byok,
      body: { projectId: PROJECT, prompt: "x", provider: "anthropic", model: "claude-sonnet-5" },
    });
    expect(lastPlannerCall?.selection).toMatchObject({ providerId: "anthropic", model: "claude-sonnet-5" });
  });

  it("an unknown provider is a 400 — never a silent default that spends the key elsewhere", async () => {
    const res = await run([], { headers: byok, body: { projectId: PROJECT, prompt: "x", provider: "gemini" } });
    expect(res.status).toBe(400);
    expect(runPlannerMock).not.toHaveBeenCalled();
  });

  it("a malformed key header is a 400 that does not echo the value", async () => {
    const res = await run([], { headers: { "x-hite-provider-key": '"quoted"' } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("x-hite-provider-key: not a valid API key");
    expect(body.error).not.toContain("quoted");
  });

  it("the key appears in NO SSE frame, even when the provider echoes it back in an error", async () => {
    // A provider's 4xx body can carry request metadata; the chat bubble renders route errors verbatim.
    const events = await sseEvents(
      await run([], { headers: byok, fail: new Error(`API key ${SENTINEL_KEY} is not authorized`) }),
    );
    const raw = JSON.stringify(events);
    expect(raw).not.toContain(SENTINEL_KEY);
    expect(raw).toContain("[redacted]");
  });
});

describe("a turn that already produced a valid batch is not thrown away", () => {
  it("a stream fault after a validated emit still persists it, and says the turn ended early", async () => {
    // At high effort the fault usually lands on a REVISION round — losing the edit (and the user's
    // daily credit) because the polishing pass timed out is the worst possible outcome.
    const events = await sseEvents(
      await run([{ type: "start-step" }, emit({ commands: [{ type: "ADD_MARKER", atTick: 0, title: "kept" }], summary: "kept" })], {
        body: { projectId: PROJECT, prompt: "x", effort: "standard" },
        executeEmit: true,
        fail: new Error("planner stream aborted"),
      }),
    );
    expect(types(events)).toContain("warning");
    expect(types(events)).toContain("edit-saved");
    expect(insertedEdits).toHaveLength(1);
  });

  it("a stream fault with NOTHING validated is reported as the error it is", async () => {
    const events = await sseEvents(await run([], { fail: new Error("planner stream aborted") }));
    expect((events.find((e) => e.type === "error")?.data as { message: string }).message).toBe("planner stream aborted");
    expect(insertedEdits).toHaveLength(0);
  });

  it("a contract violation is NEVER salvaged, even with a valid batch in hand", async () => {
    // Two emits in one step means the batch we hold may not be the one the summary describes.
    const events = await sseEvents(
      await run([
        { type: "start-step" },
        emit({ commands: [{ type: "ADD_MARKER", atTick: 0, title: "a" }], summary: "a" }),
        emit({ commands: [{ type: "ADD_MARKER", atTick: 1, title: "b" }], summary: "b" }),
      ]),
    );
    expect((events.find((e) => e.type === "error")?.data as { message: string }).message).toBe(
      "planner emitted multiple edit batches",
    );
    expect(insertedEdits).toHaveLength(0);
  });
});
