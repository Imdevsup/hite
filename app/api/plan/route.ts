import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { createAdmin } from "@/lib/supabase/admin";
import { runPlanner } from "@/lib/ai/agents/planner";
import { PlannerContractError, failureMessage, reviewSummary } from "@/lib/ai/agents/critique";
import { Edl, emptyEdl2, type Edl as EdlType } from "@/lib/edl/schema";
import { upgradeEdlV1toV2 } from "@/lib/edl/migrate";
import { redactProviderKey } from "@/lib/ai/providers/credential";
import { ProviderSelectionBody, resolveProviderRun } from "@/lib/ai/providers/request";
import { EFFORT_LEVELS } from "@/lib/ai/effort";
import { describeCommand } from "@/lib/editor/describeCommand";
import { summarizeEdl } from "@/lib/ai/timeline";
import { msToTicks } from "@/lib/edl/time";
import { requireRateLimit } from "@/lib/api/rate-limit";
import { parseJsonBody } from "@/lib/api/body";
// One owner for both: a bad body's 400 and an error thrown inside the SSE stream are rendered by the
// same chat bubble, so /api/plan and /api/refine must phrase them identically.
import { errorMessage } from "@/lib/api/errors";
import { z } from "zod";

export const runtime = "nodejs";
/**
 * Sized for the TOP of the effort ladder, not the middle: a max-effort turn is a grounding phase, an
 * emit, up to three critique rounds and a DB write, and 60s cannot hold that. 300s is the Vercel
 * Fluid ceiling on Hobby, so no plan upgrade is needed — but on a self-hosted Node server there is
 * no platform ceiling at all and the real bound is `EffortProfile.wallClockMs`, which is enforced
 * per level here and in the SDK. Every level's budget stays under this number with room for the
 * insert. NOTE: `vercel.json#functions` also carries this value and WINS on Vercel — change both.
 */
export const maxDuration = 300;

const Body = z
  .object({
    projectId: z.string().uuid(),
    prompt: z.string().min(1).max(4000),
    // Validated against the enum, never coerced: an unknown level is a client contract violation and
    // gets a 400 naming the field, rather than being silently downgraded to something cheaper. An
    // ABSENT level is different — that falls back to the ladder's default (lib/ai/effort).
    effort: z.enum(EFFORT_LEVELS).optional(),
  })
  // Provider / model / surface / baseUrl — non-secret, so they ride the body. The KEY never does.
  .merge(ProviderSelectionBody);

/**
 * Initial planning call. The planner analyzes, then emits ONE typed EditBatch via the terminal
 * `emitEditBatch` tool — whose `execute` reduces it against the parent Edl.2 and, above draft
 * effort, hands the result back for a critique round. The route persists the last batch that was
 * proven to apply (`run.lastValid`), never an unvalidated one. SSE events:
 *   effort   — the level this turn actually ran at (may be clamped below what was requested)
 *   text     — planner narration deltas
 *   tool-call / tool-result — analysis + (above draft) each emit/review round, for the activity log
 *   edl      — the final Edl.2 (the client swaps it into the store)
 *   summary  — one-line description of the change
 *   changes  — per-command descriptions
 *   no-op    — the planner answered without an edit (nothing reduced, nothing persisted)
 *   warning  — the turn ended early but a validated batch was salvaged
 *   edit-saved / error / [DONE]
 */
export function POST(req: Request) {
  return withAuth(async ({ user, supabase }) => {
    // A bad body is a CLIENT contract violation, so it must be a 400: `Body.parse` threw straight
    // through withAuth into Next's generic 500 and `projectId: "undefined"` read as a server outage
    // in the logs. `parseJsonBody` is the one owner of that 400 (invalid JSON and a schema miss take
    // the same path, phrased by the same `zodMessage`) — see lib/api/body.ts.
    const body = await parseJsonBody(req, Body);

    // Provider, model, credential and rung in one call. BYOK is the only path: with no usable key
    // this throws a 402 pointing at settings — it never falls through to a deployer credential,
    // because there isn't one. The rung is clamped server-side to what the chosen provider can
    // actually serve, and the level it ran at is reported back on the stream.
    const { selection, credential, effort } = resolveProviderRun(req, body.effort, body);

    // The spend gate, via the one helper an expensive route cannot write wrong (lib/api/rate-limit.ts).
    await requireRateLimit(user.id, "plan");

    const { data: project } = await supabase
      .from("project")
      .select("id")
      .eq("id", body.projectId)
      .single();
    if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

    const [{ data: assets }, { data: parentEdit }] = await Promise.all([
      supabase.from("asset").select("id, filename, duration_ms, blob_url").eq("project_id", body.projectId),
      supabase
        .from("edit")
        .select("id, version, edl")
        .eq("project_id", body.projectId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const primary = (assets ?? []).find((a) => a.duration_ms && a.duration_ms > 0);
    if (!primary) return NextResponse.json({ error: "no usable asset" }, { status: 400 });

    // The reducer is pure and cannot read asset rows; without these it bounds every clip it mints by
    // the clip's own out point, which made "extend that clip by 2 seconds" a silent no-op. Only real,
    // probed durations go in — an unknown/zero one must stay unknown, never a fabricated length.
    const assetDurationsTicks: Record<string, number> = {};
    for (const a of assets ?? []) {
      if (a.duration_ms != null && a.duration_ms > 0) assetDurationsTicks[a.id] = msToTicks(a.duration_ms);
    }

    const parentEdl = loadParentEdl(parentEdit?.edl, primary);

    const admin = createAdmin();
    const nextVersion = (parentEdit?.version ?? 0) + 1;

    const { stream, run } = await runPlanner({
      projectId: body.projectId,
      editId: `v${nextVersion}`,
      parentSummary: summarizeEdl(parentEdl),
      prompt: body.prompt,
      assetContext: (assets ?? []).map((a) => ({ id: a.id, filename: a.filename, duration_ms: a.duration_ms })),
      mode: "plan",
      effort,
      selection,
      credential,
      parentEdl,
      assetDurationsTicks,
    });

    const encoder = new TextEncoder();
    const sse = new ReadableStream({
      async start(controller) {
        const send = (type: string, data: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));

        try {
          send("effort", {
            level: effort.level,
            requested: body.effort ?? null,
            provider: selection.providerId,
            model: selection.model,
            revisions: effort.revisions,
          });

          let lastEmitInput: unknown = null;
          let streamFault: string | null = null;
          // Emits as the ROUTE sees them. Only the second and later rounds reach the activity log:
          // a one-shot turn's emit has always been hidden there, and showing it now would add noise
          // to every default request — while a REVIEW round is exactly the progress a 100s turn
          // needs to show. The counter is the route's own view, so it does not race the tool loop.
          let emitAttempts = 0;

          try {
            for await (const part of stream.fullStream) {
              if (part.type === "start-step") {
                run.beginStreamStep();
              } else if (part.type === "text-delta") {
                send("text", part.text);
              } else if (part.type === "tool-call") {
                if (part.toolName === "emitEditBatch") {
                  // Gemini may legally emit PARALLEL function calls in one step. Taking the last
                  // applied only half the edit while the summary described all of it — the user is
                  // told cuts happened that never did. One emit per step; several ACROSS steps is
                  // the revise loop and is exactly what higher effort is buying.
                  run.noteStreamEmit();
                  lastEmitInput = part.input;
                  emitAttempts += 1;
                  if (emitAttempts > 1) send("tool-call", { name: part.toolName, args: { attempt: emitAttempts } });
                } else {
                  send("tool-call", { name: part.toolName, args: part.input });
                }
              } else if (part.type === "tool-result") {
                if (part.toolName === "emitEditBatch") {
                  if (emitAttempts > 1) send("tool-result", { name: part.toolName, result: reviewSummary(part.output) });
                } else {
                  send("tool-result", { name: part.toolName, result: part.output });
                }
              } else if (part.type === "finish") {
                send("finish", { usage: part.totalUsage });
              } else {
                // streamText surfaces model/gateway failures as error/abort parts (it does NOT throw).
                // Re-throw so the catch below decides between salvaging and reporting.
                const t = part.type as string;
                if (t === "error" || t === "tool-error") {
                  const err = (part as { error?: unknown }).error;
                  throw err instanceof Error ? err : new Error(String(err ?? "planner stream error"));
                }
                if (t === "abort") throw new Error("planner stream aborted");
              }
            }
          } catch (e) {
            // A turn that already produced a batch which PROVABLY applies is worth more than the
            // error that interrupted its next revision — the alternative is losing the edit and the
            // user's daily credit to a timeout on the round that was only polishing. A contract
            // violation is never salvaged: that one means the batch we hold may not be the one the
            // summary describes.
            if (e instanceof PlannerContractError || !run.lastValid) throw e;
            streamFault = errorMessage(e);
            send("warning", { message: `Finished early: ${redactProviderKey(streamFault, credential)}` });
          }

          // Safety net for a stream whose emit tool never executed (draft's stop condition fires on
          // the tool CALL, and it must not depend on `execute` having run). Validation and the
          // reduce still have exactly one owner — `run.dryRun`.
          if (run.emitCount === 0 && lastEmitInput !== null) run.dryRun(lastEmitInput);

          // The prompt's own contract: an impossible/empty request is answered with an
          // `emitEditBatch` carrying an explanation and NO commands. That is a valid turn — stream
          // the explanation, reduce and persist nothing (no phantom version, no bogus error).
          if (run.noOp) {
            send("summary", run.noOp.summary || "No change — nothing to apply.");
            send("no-op", { reason: "planner emitted no commands" });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            return;
          }

          if (!run.lastValid) {
            send("error", { message: redactProviderKey(failureMessage(run.lastProblems, streamFault), credential) });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            return;
          }

          const { batch, edl: finalEdl } = run.lastValid;

          // Persist ONLY on success — never leave a phantom no-op version on failure.
          // Throw on a DB error so the catch emits an `error` event BEFORE any `edl` is sent;
          // otherwise the client would swap in (and show) an edit that was never saved and
          // silently vanishes on reload.
          const { data: inserted, error: insertErr } = await admin
            .from("edit")
            .insert({
              project_id: body.projectId,
              version: nextVersion,
              parent_edit_id: parentEdit?.id ?? null,
              prompt: body.prompt,
              edl: finalEdl,
            })
            .select("id")
            .single();
          if (insertErr || !inserted) {
            throw new Error(`couldn't save the edit: ${insertErr?.message ?? "no row returned"}`);
          }
          send("edl", finalEdl);
          send("summary", batch.summary);
          send("changes", batch.commands.map(describeCommand));
          send("edit-saved", { editId: inserted.id, version: nextVersion });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (e) {
          send("error", { message: redactProviderKey(errorMessage(e), credential) });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(sse, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      },
    });
  });
}

/** Load the parent timeline as Edl.2: parse if already v2, migrate if v1, else seed empty. */
function loadParentEdl(
  raw: unknown,
  primary: { id: string; duration_ms: number | null; blob_url: string | null },
): EdlType {
  if (raw && typeof raw === "object") {
    if ((raw as { schema?: string }).schema === "Edl.2") return Edl.parse(raw);
    return upgradeEdlV1toV2(raw);
  }
  return emptyEdl2(primary.id, msToTicks(primary.duration_ms ?? 0), primary.blob_url ?? "");
}
