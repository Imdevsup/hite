import { streamText, stepCountIs, hasToolCall, tool, type Tool, type ToolSet } from "ai";
import { modelForSelection } from "@/lib/ai/providers/factory";
import { providerOptionsFor } from "@/lib/ai/providers/options";
import { sanitizeProviderText } from "@/lib/ai/keys";
import { errorMessage } from "@/lib/api/errors";
import type { KeySource } from "@/lib/ai/providers/credential";
import type { ModelSelection } from "@/lib/ai/providers/types";
import { FlatEditBatch } from "@/lib/ai/edit-batch-flat";
import { systemPlanner, systemRefiner } from "@/lib/ai/prompts/prompts.generated";
import { selectToolSpecs, toolGuide } from "@/lib/ai/tools/router";
import type { ToolSpec } from "@/lib/ai/tools/registry";
import { msToTicks } from "@/lib/edl/time";
import type { Edl } from "@/lib/edl/schema";
import type { EffortProfile } from "@/lib/ai/effort";
import { PlannerRun } from "@/lib/ai/agents/critique";

/**
 * HITE planner — the senior editor. A streaming tool-loop via AI SDK v6.
 *
 *   • Model:         whichever provider + model the USER chose, built from their own key
 *                    (lib/ai/providers/factory.ts). There is no deployer key pool to fall back to.
 *   • Read tools:    analysis (transcript/beats/scenes/faces/frames) + registry search
 *   • Terminal tool: `emitEditBatch` — the model MUST end its turn by emitting a typed EditBatch.
 *                    Its `execute` APPLIES that batch against the parent Edl.2 and hands the result
 *                    back (lib/ai/agents/critique.ts), which is what lets the loop revise.
 *   • Shape:         set by the effort ladder (lib/ai/effort.ts), not hard-coded here. Draft is
 *                    one-shot; standard repairs a rejected batch; high/max critique a VALID one.
 *
 * Prompts are imported from prompts.generated.ts (bundled as code) — NOT read from disk at runtime,
 * which ENOENT-500ed the function on Vercel.
 */

export interface PlannerInput {
  projectId: string;
  editId: string;
  /** Compact human-readable summary of the parent timeline (not the raw EDL). */
  parentSummary: string;
  prompt: string;
  assetContext: Array<{ id: string; filename: string; duration_ms: number | null }>;
  /** 'plan' uses the planner system prompt; 'refine' uses the refiner prompt. */
  mode: "plan" | "refine";
  /** The resolved rung of the effort ladder — already clamped to what this provider can serve. */
  effort: EffortProfile;
  /** Which provider + model this turn runs on. Resolved by lib/ai/providers/request.ts. */
  selection: ModelSelection;
  /** The user's own credential. `{ kind: "none" }` only for a self-hosted endpoint. */
  credential: KeySource;
  /**
   * HARNESS ONLY (`scripts/verify-provider.ts`). Canned results for the router's analysis tools,
   * keyed by tool name.
   *
   * The tool SURFACE the model sees stays byte-identical — same names, same descriptions, same
   * input schemas, because they are the same `ToolSpec` objects; only each `execute` is swapped.
   * That is what makes the harness a measurement of the MODEL rather than of a database: the single
   * variable under test is which model is answering. Never set on a real request.
   */
  offlineToolResults?: Readonly<Record<string, unknown>>;
  /** The timeline the batch is reduced against, in-process, on every emit. */
  parentEdl: Edl;
  /** Real probed media lengths, so an extend-a-clip trim is not silently clamped to a no-op. */
  assetDurationsTicks: Record<string, number>;
  /** Injected clock for the wall-clock deadline (tests). */
  now?: () => number;
}

/**
 * The asset lines the model reads before it writes any tick field. Length is given in TICKS first
 * (ms in parentheses) for the same reason the timeline summary is — every command field the model
 * writes is ticks, and a ms-only line is a 30× seam it copies straight through.
 *
 * It is also the HARD BOUND: a clip whose `outTick` is past the asset's real length fails the WHOLE
 * batch (`clip_exceeds_media` in the reducer), and this line is the only place the model can learn
 * that number. An unprobed asset says "unknown" rather than a fabricated length.
 * Pure — exported for tests.
 */
export function assetContextLines(assets: PlannerInput["assetContext"]): string {
  return assets
    .map((a) => {
      const ms = a.duration_ms;
      if (ms == null || ms <= 0) return `- ${a.id} :: ${a.filename} :: length unknown (not probed yet)`;
      const ticks = msToTicks(ms);
      return `- ${a.id} :: ${a.filename} :: length=${ticks}t (${ms}ms) — inTick/outTick must stay within [0, ${ticks}]`;
    })
    .join("\n");
}

const EMIT_TOOL = "emitEditBatch";

const EMIT_DESCRIPTION =
  "Emit the final batch of edit commands to apply to the timeline. Each command is one flat object " +
  "with a `type` (ADD_CLIP, TRIM_CLIP, ADD_EFFECT, ADD_TRANSITION, ADD_OVERLAY, COMPOSE_LOOK, " +
  "ADD_CAPTION, …) plus the fields that type needs. Include a concise one-line `summary` of the " +
  "change for the user. You MUST call this to finish — never describe the edits as plain text.";

/**
 * At a level with revisions the tool is no longer terminal, and the model has to be told so — it
 * returns the applied result, and calling it a second time is the sanctioned way to correct or
 * confirm. At draft the loop stops on the first call, so promising a review there would be a lie.
 */
function emitDescription(effort: EffortProfile): string {
  if (effort.revisions === 0) return `${EMIT_DESCRIPTION} Call this exactly once, at the end of your turn.`;
  return (
    `${EMIT_DESCRIPTION} It returns what your batch actually produced when applied to the real ` +
    "timeline, so you can check your work and, if needed, call it again with a corrected batch."
  );
}

/**
 * Swap ONE tool's `execute` for a fixture, keeping its name, description and input schema exactly as
 * the registry declares them. The cast is narrow and deliberate: `Tool`'s `execute` is generic over
 * the schema's inferred input, and the harness's fixture is a recorded JSON value that does not
 * carry that generic. Everything the model can observe is unchanged.
 */
function fixtureTool(spec: ToolSpec, result: unknown): Tool {
  return { ...spec.tool, execute: async () => result } as Tool;
}

/**
 * Two backstops that both have to exist, because they fail differently:
 *
 *  - `stepCountIs` is the SDK's cap on how many model calls a turn may make.
 *  - the wall-clock deadline is the platform's. A turn killed by `maxDuration` mid-thought loses the
 *    edit AND the user's daily credit, so past the deadline `prepareStep` forces the emit instead.
 */
export async function runPlanner(opts: PlannerInput) {
  const contextLines = assetContextLines(opts.assetContext);
  const effort = opts.effort;

  const basePrompt = opts.mode === "plan" ? systemPlanner : systemRefiner;
  // The router selects the tools for THIS request; their whenToUse lines are appended to the
  // system prompt so the model knows when to reach for each (the "which tool when" signal).
  // Effort does NOT widen this set: selection accuracy collapses past ~16 tools, so showing high
  // effort more tools would make it worse. Effort buys depth, not breadth.
  const specs = selectToolSpecs(opts.prompt);
  const system = `${basePrompt}\n\n## Tools available this turn (call only when the request needs them)\n${toolGuide(specs)}`;

  const run = new PlannerRun({
    effort,
    parentEdl: opts.parentEdl,
    assetDurationsTicks: opts.assetDurationsTicks,
    prompt: opts.prompt,
    now: opts.now,
  });

  const fixtures = opts.offlineToolResults;
  // `ToolSet` is annotated, not inferred: the router's tools arrive through `Object.fromEntries` (an
  // index signature), and inference drops that, narrowing `keyof TOOLS` to the one literal key below
  // — which then rejects every router tool name in `activeTools`.
  const tools: ToolSet = {
    ...Object.fromEntries(specs.map((s) => [s.name, fixtures ? fixtureTool(s, fixtures[s.name]) : s.tool])),
    [EMIT_TOOL]: tool({
      description: emitDescription(effort),
      inputSchema: FlatEditBatch,
      // The dry run IS the tool's result: map → reduce → describe what it produced. No DB, no
      // network. The route reads `run.lastValid` afterwards, so the reduce happens once, here.
      execute: (input: unknown) => run.dryRun(input),
    }),
  };
  /** Every tool the router picked — analysis, advisors, registry search — but NOT the emit. */
  const investigationToolNames = specs.map((s) => s.name);

  // Draft keeps today's stop semantics exactly: the first emit ends the turn, and that decision
  // does not depend on the tool's `execute` having run. Above draft the run decides for itself.
  const stopWhen =
    effort.revisions === 0
      ? [hasToolCall(EMIT_TOOL), stepCountIs(effort.steps)]
      : [() => run.settled, stepCountIs(effort.steps)];

  // Built per request, never cached by key: a provider instance closes over the user's credential,
  // and a module-level cache would outlive their request. The `await` is the dynamic provider import
  // (lib/ai/providers/factory.ts) — only the chosen provider's module is evaluated.
  const model = await modelForSelection(opts.selection, opts.credential);

  return {
    run,
    stream: streamText({
      model,
      providerOptions: providerOptionsFor(opts.selection, effort.thinking),
      // ai-planner-patterns.md: no blind SDK retries — `providerFetch` already handles a
      // provider-side blip with exactly one deterministic soft retry.
      maxRetries: 0,
      /**
       * OVERRIDING THIS IS A LEAK FIX, not a formatting preference.
       *
       * `streamText`'s default `onError` is `({ error }) => console.error(error)` (verified in
       * ai@6.0.168/dist/index.mjs:6394). That dumps the whole `AI_APICallError` — including its
       * `responseBody` — straight into the server log, unredacted. Providers DO echo credentials
       * there: Google's own invalid-key body is literally `API key not valid: AIza…`, which is why
       * `sanitizeProviderText` carries a pattern net at all. The route's redaction only covers what
       * the route emits, so without this the one place a BYOK key could still reach a log was a
       * callback nobody wrote.
       *
       * The error is still surfaced as an `error` part on `fullStream`, so the routes' salvage and
       * reporting behaviour is untouched; this replaces a raw object dump with one redacted line.
       */
      onError: ({ error }) => {
        console.error(`[planner] ${sanitizeProviderText(errorMessage(error), opts.credential)}`);
      },
      // The hard ceiling on function-seconds. If it fires the route still persists `lastValid`, so a
      // long max-effort turn degrades to "the best batch it had", never to a lost turn.
      timeout: { totalMs: effort.wallClockMs },
      system,
      // Scope analysis tools to THIS project's assets — the tools query with the admin client, so
      // this is the cross-tenant IDOR guard (see lib/ai/tools/_guard.ts), and it fails CLOSED: drop
      // this and every analysis tool refuses rather than reading whatever id the model asked for.
      experimental_context: { allowedAssetIds: opts.assetContext.map((a) => a.id) },
      stopWhen,
      prepareStep: ({ stepNumber }) => {
        // Out of time: end the turn WITH a batch rather than be killed mid-thought.
        if (run.pastDeadline && !run.lastValid) {
          return { toolChoice: { type: "tool", toolName: EMIT_TOOL }, activeTools: [EMIT_TOOL] };
        }
        // GROUND phase: withhold the emit tool so the model physically cannot skip investigation.
        // This is the structural version of "please analyse first", which the prompt has always
        // asked for and a cheap model has always been happy to ignore.
        //
        // `toolChoice: "required"` is load-bearing, not belt-and-braces: the SDK's loop only
        // continues after a step that made a tool call, so a grounding step the model answered with
        // prose would END the turn with no batch at all — turning "investigate first" into "lose the
        // edit". Requiring a call costs at most a redundant analysis hop; not requiring one costs
        // the whole turn.
        if (stepNumber < effort.groundSteps && investigationToolNames.length > 0) {
          return { activeTools: investigationToolNames, toolChoice: "required" };
        }
        return {};
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Current edit id: ${opts.editId}` },
            { type: "text", text: `Timeline summary:\n${opts.parentSummary}` },
            { type: "text", text: `Assets:\n${contextLines}` },
            { type: "text", text: `User request: ${opts.prompt}` },
            { type: "text", text: effort.toolGuidance },
          ],
        },
      ],
      tools,
    }),
  };
}
