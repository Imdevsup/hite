import { describe, expect, test, vi, beforeEach } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { convertArrayToReadableStream } from "@ai-sdk/provider-utils/test";
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { emptyEdl2, type Edl } from "@/lib/edl/schema";

/**
 * Two suites here, and the second is the point of the whole unit.
 *
 * `assetContextLines` is pure and tested directly. The loop is tested by driving the REAL AI SDK
 * tool loop with a scripted model: the stop condition, `prepareStep`, the emit tool's `execute` and
 * the critique round are all the production code path, and the only thing faked is what the model
 * says back. Assertions are about how many times the model was called and what it was shown —
 * because "high effort does more work" is a claim about exactly those two things.
 */

const { modelMock } = vi.hoisted(() => ({ modelMock: { current: null as MockLanguageModelV3 | null } }));

// Only the FACTORY is faked — the provider layer's own resolution, options translation and fetch
// policy have their own suites, and what this file is testing is the loop, not the transport.
vi.mock("@/lib/ai/providers/factory", () => ({
  modelForSelection: async () => modelMock.current,
}));

const { assetContextLines, runPlanner } = await import("./planner");
const { EFFORT } = await import("@/lib/ai/effort");

describe("assetContextLines", () => {
  /**
   * The asset block is the only place the model learns an asset's real length — and that length is a
   * HARD bound: `mediaEndTick` fails the whole batch (`clip_exceeds_media`) when a clip's outTick
   * runs past it. The block used to give milliseconds only, while every command field the model
   * writes is ticks, so the one number it needed was 30× off from the unit it was writing in.
   */
  test("states the length in ticks (ms in parentheses) and names the bound", () => {
    const line = assetContextLines([{ id: "a1", filename: "clip.mp4", duration_ms: 30_000 }]);
    expect(line).toBe("- a1 :: clip.mp4 :: length=900000t (30000ms) — inTick/outTick must stay within [0, 900000]");
  });

  test("an unprobed asset says unknown — never a fabricated length", () => {
    expect(assetContextLines([{ id: "a2", filename: "x.mp4", duration_ms: null }])).toContain("length unknown");
    expect(assetContextLines([{ id: "a3", filename: "y.mp4", duration_ms: 0 }])).toContain("length unknown");
  });

  test("one line per asset", () => {
    const lines = assetContextLines([
      { id: "a1", filename: "a.mp4", duration_ms: 1000 },
      { id: "a2", filename: "b.mp4", duration_ms: 2000 },
    ]).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("length=60000t");
  });
});

// ── the loop ────────────────────────────────────────────────────────────────

const ASSET = "11111111-1111-4111-8111-111111111111";
const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
  totalTokens: 15,
};

const emitStep = (batch: unknown, id: string): LanguageModelV3StreamPart[] => [
  { type: "stream-start", warnings: [] },
  { type: "tool-call", toolCallId: id, toolName: "emitEditBatch", input: JSON.stringify(batch) },
  { type: "finish", finishReason: { unified: "tool-calls", raw: "STOP" }, usage: USAGE },
];

const textStep = (text: string): LanguageModelV3StreamPart[] => [
  { type: "stream-start", warnings: [] },
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "text-end", id: "t" },
  { type: "finish", finishReason: { unified: "stop", raw: "STOP" }, usage: USAGE },
];

const marker = (title: string) => ({ commands: [{ type: "ADD_MARKER", atTick: 0, title }], summary: title });
const badBatch = { commands: [{ type: "REMOVE_CLIP", clipId: "ghost" }], summary: "bad" };

let calls: LanguageModelV3CallOptions[] = [];

/** Script the model's successive turns; every call is recorded for inspection. */
function scriptModel(script: LanguageModelV3StreamPart[][]): void {
  let i = 0;
  modelMock.current = new MockLanguageModelV3({
    doStream: async (options) => {
      calls.push(options);
      const parts = script[Math.min(i++, script.length - 1)];
      return { stream: convertArrayToReadableStream(parts) };
    },
  });
}

const parentEdl = (): Edl => emptyEdl2(ASSET, 300_000, "https://blob/clip.mp4");

type Level = keyof typeof EFFORT;
interface DriveOptions {
  prompt?: string;
  now?: () => number;
  /** Override a single rung field to isolate one lever (e.g. a 1-step grounding phase). */
  effort?: Partial<(typeof EFFORT)[Level]>;
}

async function drive(level: Level, { prompt = "add a marker at the start", now, effort }: DriveOptions = {}) {
  const { stream, run } = await runPlanner({
    projectId: "p",
    editId: "v1",
    parentSummary: "duration=300000t",
    prompt,
    assetContext: [{ id: ASSET, filename: "clip.mp4", duration_ms: 30_000 }],
    mode: "plan",
    effort: { ...EFFORT[level], ...effort },
    selection: { providerId: "google", model: "gemini-2.5-flash", surface: null, baseUrl: null },
    credential: { kind: "byok", key: "AIzaSyTESTkeyNOTreal0123456789abc" },
    parentEdl: parentEdl(),
    assetDurationsTicks: { [ASSET]: 900_000 },
    now,
  });
  for await (const part of stream.fullStream) void part; // drain, exactly as the routes do
  return run;
}

/** Everything the model was shown on call N, as one searchable string. */
const promptText = (n: number) => JSON.stringify(calls[n].prompt);
const toolNames = (n: number) => (calls[n].tools ?? []).map((t) => t.name);

beforeEach(() => {
  calls = [];
});

describe("draft is one shot — today's behaviour, unchanged", () => {
  test("one model call, and the emitted batch is validated and kept", async () => {
    scriptModel([emitStep(marker("beat"), "c1")]);
    const run = await drive("draft");
    expect(calls).toHaveLength(1);
    expect(run.emitCount).toBe(1);
    expect(run.lastValid).not.toBeNull();
    expect(run.lastValid?.batch.summary).toBe("beat");
  });

  test("the emit tool is offered from the very first step — no grounding floor", async () => {
    scriptModel([emitStep(marker("beat"), "c1")]);
    await drive("draft");
    expect(toolNames(0)).toContain("emitEditBatch");
  });

  test("a valid batch is NEVER critiqued at draft, however wrong it looks", async () => {
    // The batch leaves a 10s timeline at 10s against an explicit 5s target — high would push back;
    // draft must not, because draft's contract is speed.
    scriptModel([emitStep(marker("beat"), "c1"), emitStep(marker("beat"), "c2")]);
    await drive("draft", { prompt: "cut this down to a 5 second version" });
    expect(calls).toHaveLength(1);
  });
});

describe("high effort actually does more work", () => {
  test("a VALID batch is applied, handed back, and the model gets a second turn to check it", async () => {
    scriptModel([emitStep(marker("beat"), "c1"), emitStep(marker("beat"), "c2")]);
    const run = await drive("high");

    expect(calls).toHaveLength(2); // ← draft would have stopped at 1
    expect(run.emitCount).toBe(2);
    expect(run.lastValid).not.toBeNull();
  });

  test("the critique carries the timeline the batch REALLY produced, plus the instruction", async () => {
    scriptModel([emitStep(marker("beat"), "c1"), emitStep(marker("beat"), "c2")]);
    await drive("high");

    const shown = promptText(1);
    expect(shown).toContain("Compare it against the user's request");
    expect(shown).toContain("duration=300000t"); // the real post-batch timeline, not a restatement
    expect(shown).toContain("Marker · beat"); // what was applied, in the user's own wording
  });

  test("a measured mismatch with the request reaches the model as a computed fact", async () => {
    scriptModel([emitStep(marker("beat"), "c1"), emitStep(marker("beat"), "c2")]);
    await drive("high", { prompt: "cut this down to a 5 second version" });
    expect(promptText(1)).toContain("Length target");
    expect(promptText(1)).toContain("100% OVER");
  });

  test("a rejected batch comes back with the field-named reason, and the repair is what persists", async () => {
    scriptModel([emitStep(badBatch, "c1"), emitStep(marker("fixed"), "c2")]);
    const run = await drive("high");

    expect(promptText(1)).toContain("REJECTED");
    expect(promptText(1)).toContain("ghost");
    expect(run.lastValid?.batch.summary).toBe("fixed");
  });

  test("a model that goes quiet after the critique still ships the batch it already validated", async () => {
    scriptModel([emitStep(marker("beat"), "c1"), textStep("Looks right to me.")]);
    const run = await drive("high");
    expect(run.lastValid?.batch.summary).toBe("beat");
  });

  test("a no-op answer is never critiqued into an edit, even at max", async () => {
    scriptModel([emitStep({ commands: [], summary: "Nothing to cut." }, "c1"), emitStep(marker("x"), "c2")]);
    const run = await drive("max");
    expect(calls).toHaveLength(1);
    expect(run.noOp?.summary).toBe("Nothing to cut.");
    expect(run.lastValid).toBeNull();
  });
});

describe("standard repairs, but does not second-guess a valid batch", () => {
  test("a valid batch ends the turn in ONE call — auto-repair is free when nothing failed", async () => {
    scriptModel([emitStep(marker("beat"), "c1"), emitStep(marker("beat"), "c2")]);
    const run = await drive("standard");
    expect(calls).toHaveLength(1);
    expect(run.lastValid).not.toBeNull();
  });

  test("a batch the reducer rejects gets exactly one repair round instead of failing the turn", async () => {
    // Today this whole class of failure surfaces as an error with the daily credit already spent.
    scriptModel([emitStep(badBatch, "c1"), emitStep(marker("fixed"), "c2")]);
    const run = await drive("standard");
    expect(calls).toHaveLength(2);
    expect(run.lastValid?.batch.summary).toBe("fixed");
  });

  test("a second failure ends the turn rather than looping", async () => {
    scriptModel([emitStep(badBatch, "c1"), emitStep(badBatch, "c2"), emitStep(marker("late"), "c3")]);
    const run = await drive("standard");
    expect(calls).toHaveLength(2);
    expect(run.lastValid).toBeNull();
    expect(run.lastProblems[0]).toContain("ghost");
  });
});

describe("the grounding phase makes 'investigate first' structural", () => {
  test("high withholds emitEditBatch on the first steps, so it cannot guess and emit", async () => {
    scriptModel([emitStep(marker("beat"), "c1")]);
    await drive("high");
    expect(toolNames(0)).not.toContain("emitEditBatch");
    expect(toolNames(0).length).toBeGreaterThan(0); // the analysis tools ARE there
    expect(calls[0].toolChoice).toEqual({ type: "required" });
  });

  test("the emit tool comes BACK once the grounding steps are done", async () => {
    // Withholding it forever would be a turn that can never finish; one grounding step isolates the
    // handover without needing the model to make a real analysis call.
    scriptModel([emitStep(marker("beat"), "c1"), emitStep(marker("beat"), "c2")]);
    await drive("high", { effort: { groundSteps: 1 } });
    expect(toolNames(0)).not.toContain("emitEditBatch");
    expect(toolNames(1)).toContain("emitEditBatch");
    expect(calls[1].toolChoice).toEqual({ type: "auto" }); // and the model is free again
  });

  test("standard and draft ground nothing — the cheap path is untouched", async () => {
    for (const level of ["draft", "standard"] as const) {
      calls = [];
      scriptModel([emitStep(marker("beat"), "c1")]);
      await drive(level);
      expect(toolNames(0), level).toContain("emitEditBatch");
      expect(calls[0].toolChoice, level).toEqual({ type: "auto" }); // the model decides, as today
    }
  });
});

describe("the wall-clock deadline ends the turn with a batch, not with nothing", () => {
  test("past the deadline the emit tool is FORCED, so the turn cannot be killed mid-thought", async () => {
    let clock = 0;
    // Already inside the reserve when the first step is prepared.
    scriptModel([emitStep(marker("beat"), "c1")]);
    await drive("high", {
      prompt: "add a marker",
      now: () => {
        const t = clock;
        clock += EFFORT.high.wallClockMs; // the first read sets the deadline, the next is past it
        return t;
      },
    });
    expect(calls[0].toolChoice).toEqual({ type: "tool", toolName: "emitEditBatch" });
    expect(toolNames(0)).toEqual(["emitEditBatch"]);
  });
});

/**
 * THE ERROR CALLBACK — a leak fix, verified by driving the real SDK loop.
 *
 * `streamText`'s default `onError` is `({ error }) => console.error(error)` (ai@6.0.168), which
 * dumps the whole `AI_APICallError` — `responseBody` included — into the server log unredacted.
 * Providers echo credentials there: Google's own invalid-key body is literally
 * `API key not valid: AIza…`. The routes' redaction covers only what the routes emit, so this
 * callback was the last place a BYOK key could reach a log.
 */
describe("a provider error never reaches the log unredacted", () => {
  const LEAKY_KEY = "AIzaSyTESTkeyNOTreal0123456789abc";

  test("the raw error object is replaced by ONE redacted line", async () => {
    const errored = vi.spyOn(console, "error").mockImplementation(() => {});
    scriptModel([
      [
        { type: "stream-start", warnings: [] },
        { type: "error", error: new Error(`API key not valid: ${LEAKY_KEY} (and again ${LEAKY_KEY})`) },
      ],
    ]);

    // The routes re-throw the `error` part; here we only need the callback to have fired.
    await drive("draft").catch(() => undefined);

    const logged = errored.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).not.toContain(LEAKY_KEY);
    expect(logged).toContain("[redacted]");
    // One line, not a dumped object graph.
    expect(logged).toContain("[planner]");
    errored.mockRestore();
  });

  test("a key-shaped string we were NEVER handed is caught by the pattern net too", async () => {
    const errored = vi.spyOn(console, "error").mockImplementation(() => {});
    scriptModel([
      [
        { type: "stream-start", warnings: [] },
        { type: "error", error: new Error("upstream said: API key not valid: AIzaSySOMEONEelsesKEY12345") },
      ],
    ]);

    await drive("draft").catch(() => undefined);

    const logged = errored.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).not.toContain("AIzaSySOMEONEelsesKEY12345");
    expect(logged).toContain("[redacted]");
    errored.mockRestore();
  });
});
