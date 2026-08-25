import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { createAdmin } from "@/lib/supabase/admin";
import { runPlanner } from "@/lib/ai/agents/planner";
import { PlannerContractError, failureMessage, reviewSummary } from "@/lib/ai/agents/critique";
import { Edl, type Edl as EdlType } from "@/lib/edl/schema";
import { upgradeEdlV1toV2 } from "@/lib/edl/migrate";
import { redactProviderKey } from "@/lib/ai/providers/credential";
import { ProviderSelectionBody, resolveProviderRun } from "@/lib/ai/providers/request";
import { EFFORT_LEVELS } from "@/lib/ai/effort";
import { describeCommand } from "@/lib/editor/describeCommand";
import { summarizeEdl } from "@/lib/ai/timeline";
import { msToTicks } from "@/lib/edl/time";
import { errorMessage } from "@/lib/api/errors"; // one owner, shared with /api/plan
import { requireRateLimit } from "@/lib/api/rate-limit";
import { parseJsonBody } from "@/lib/api/body";
import { z } from "zod";

export const runtime = "nodejs";
/** Parity with /api/plan — see the note there on the ladder, `wallClockMs`, and vercel.json. */
export const maxDuration = 300;

const Body = z
  .object({
    editId: z.string().uuid(),
    prompt: z.string().min(1).max(4000),
    /** Same contract as /api/plan: unknown level → 400; absent → the ladder's default. */
    effort: z.enum(EFFORT_LEVELS).optional(),
  })
  .merge(ProviderSelectionBody);

/**
 * Refine = plan against a specific parent edit (by id) using the refiner system prompt. Same
 * pipeline as /api/plan: the model emits ONE typed EditBatch, `emitEditBatch.execute` reduces it
 * against the parent Edl.2 (and above draft effort critiques the result), and the route appends a
 * new edit row from the batch that was proven to apply. Only writes if content actually changed.
 */
export function POST(req: Request) {
  return withAuth(async ({ user, supabase }) => {
    // A bad body is a CLIENT contract violation, so it must be a 400 — a thrown ZodError/SyntaxError
    // bubbles through withAuth into Next's generic 500. One owner for that 400: lib/api/body.ts.
    const body = await parseJsonBody(req, Body);

    // BYOK only — see /api/plan. Throws 402 when the caller brought no usable key; there is no
    // deployer credential to fall through to.
    const { selection, credential, effort } = resolveProviderRun(req, body.effort, body);

    // Same tool-loop as /api/plan, and the chat routes every turn after the first here — so
    // without this the plan cap was bypassable by planning once and refining forever (429 via withAuth).
    await requireRateLimit(user.id, "refine");
    const admin = createAdmin();

    const { data: parent } = await supabase
      .from("edit")
      .select("id, project_id, version, edl")
      .eq("id", body.editId)
      .single();
    if (!parent) return NextResponse.json({ error: "parent not found" }, { status: 404 });

    const { data: assets } = await supabase
      .from("asset")
      .select("id, filename, duration_ms")
      .eq("project_id", parent.project_id);

    // Real media lengths for the reducer (see /api/plan): without them a TRIM_CLIP that EXTENDS a
    // clip minted in this batch is silently clamped to a no-op. Only probed, non-zero durations.
    const assetDurationsTicks: Record<string, number> = {};
    for (const a of assets ?? []) {
      if (a.duration_ms != null && a.duration_ms > 0) assetDurationsTicks[a.id] = msToTicks(a.duration_ms);
    }

    const parentEdl = asEdl2(parent.edl);

    const { stream, run } = await runPlanner({
      projectId: parent.project_id,
      editId: parent.id,
      parentSummary: summarizeEdl(parentEdl),
      prompt: body.prompt,
      assetContext: assets ?? [],
      mode: "refine",
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
          /** Route-side emit counter; only review rounds reach the activity log (see /api/plan). */
          let emitAttempts = 0;

          try {
            for await (const part of stream.fullStream) {
              if (part.type === "start-step") {
                run.beginStreamStep();
              } else if (part.type === "text-delta") {
                send("text", part.text);
              } else if (part.type === "tool-call") {
                if (part.toolName === "emitEditBatch") {
                  // One emit per step — a second (parallel) call used to overwrite the first,
                  // applying half the edit while the summary claimed all of it (parity with /api/plan).
                  run.noteStreamEmit();
                  lastEmitInput = part.input;
                  emitAttempts += 1;
                  if (emitAttempts > 1) send("tool-call", { name: part.toolName, args: { attempt: emitAttempts } });
                } else send("tool-call", { name: part.toolName, args: part.input });
              } else if (part.type === "tool-result") {
                if (part.toolName === "emitEditBatch") {
                  if (emitAttempts > 1) send("tool-result", { name: part.toolName, result: reviewSummary(part.output) });
                } else {
                  send("tool-result", { name: part.toolName, result: part.output });
                }
              } else if (part.type === "finish") {
                send("finish", { usage: part.totalUsage });
              } else {
                const t = part.type as string;
                if (t === "error" || t === "tool-error") {
                  const err = (part as { error?: unknown }).error;
                  throw err instanceof Error ? err : new Error(String(err ?? "planner stream error"));
                }
                if (t === "abort") throw new Error("planner stream aborted");
              }
            }
          } catch (e) {
            // Salvage a batch that provably applies rather than lose the turn to a fault on a later
            // revision round; never salvage a contract violation (see /api/plan for the reasoning).
            if (e instanceof PlannerContractError || !run.lastValid) throw e;
            streamFault = errorMessage(e);
            send("warning", { message: `Finished early: ${redactProviderKey(streamFault, credential)}` });
          }

          // Draft's stop condition fires on the tool CALL, so the emit tool may not have executed.
          // One validation+reduce owner either way — `run.dryRun`.
          if (run.emitCount === 0 && lastEmitInput !== null) run.dryRun(lastEmitInput);

          // Zero commands = the prompt's sanctioned "can't/needn't do that" answer. Same shape as the
          // no-change branch below: explain, persist nothing.
          if (run.noOp) {
            send("summary", run.noOp.summary || "No change.");
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

          if (finalEdl.contentHash !== parentEdl.contentHash) {
            const nextVersion = parent.version + 1;
            // Throw on a DB error so the catch emits `error` BEFORE any `edl` is sent — never
            // present an edit as applied+saved that wasn't actually persisted.
            const { data: inserted, error: insertErr } = await admin
              .from("edit")
              .insert({
                project_id: parent.project_id,
                version: nextVersion,
                parent_edit_id: parent.id,
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
          } else {
            send("summary", batch.summary || "No change.");
          }
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
        // Disable proxy buffering so SSE deltas reach the client immediately (parity with /api/plan);
        // without it the refiner stream buffers and the chat feels frozen until the whole turn lands.
        "x-accel-buffering": "no",
      },
    });
  });
}

function asEdl2(raw: unknown): EdlType {
  if (raw && typeof raw === "object" && (raw as { schema?: string }).schema === "Edl.2") return Edl.parse(raw);
  return upgradeEdlV1toV2(raw);
}
