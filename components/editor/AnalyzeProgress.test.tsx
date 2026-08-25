import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AnalyzeProgress, analyzePhase, isPolling, type AnalyzeStatus } from "./AnalyzeProgress";
import { WORKER_IDLE_HINT, WORKER_IDLE_HINT_MS, analysisBranchesForKind } from "@/lib/jobs/types";

/**
 * The Media window's analysis pills polled /api/analyze/[assetId] every 1.5 s FOREVER.
 *
 * Not by oversight in the loop — by arithmetic: it counted against four hardcoded branches
 * (including `faces`, whose pipeline is cut) while the route reports three for a video and two for
 * audio, so "all done" could never be true and `clearInterval` was unreachable code. The header
 * read "ANALYSING 3/4" for the life of the page, and the `status`/`error` the route now returns —
 * the honest failure state this whole unit exists to provide — were not read at all.
 *
 * So the property under test is simply: every reachable answer ends the poll.
 */

function status(over: Partial<AnalyzeStatus> = {}): AnalyzeStatus {
  return { branches: ["transcribe", "beats", "scenes"], done: [], status: "running", error: null, ...over };
}

const settled = { consecutiveMissingJob: 0, consecutiveQueued: 0, consecutiveErrors: 0 };

describe("analyzePhase", () => {
  test("a finished VIDEO analysis is complete — three branches, not four", () => {
    const done = analysisBranchesForKind("video");
    expect(done).toHaveLength(3);
    const phase = analyzePhase({ status: status({ branches: done, done, status: "succeeded" }), ...settled });
    expect(phase).toBe("complete");
    expect(isPolling(phase)).toBe(false);
  });

  test("a finished AUDIO analysis is complete on TWO branches — a song has no shots", () => {
    const done = analysisBranchesForKind("audio");
    expect(done).toEqual(["transcribe", "beats"]);
    const phase = analyzePhase({ status: status({ branches: done, done }), ...settled });
    expect(phase).toBe("complete");
    expect(isPolling(phase)).toBe(false);
  });

  test("the rows landing is enough — the job's own status may not have caught up yet", () => {
    const branches = analysisBranchesForKind("video");
    expect(analyzePhase({ status: status({ branches, done: branches, status: "running" }), ...settled })).toBe(
      "complete",
    );
  });

  test("a failed job STOPS the poll and is not dressed as work in progress", () => {
    const phase = analyzePhase({
      status: status({ status: "failed", error: "ffprobe exited 1: Invalid data found when processing input" }),
      ...settled,
    });
    expect(phase).toBe("failed");
    expect(isPolling(phase)).toBe(false);
  });

  test("a job still working keeps the poll alive", () => {
    expect(isPolling(analyzePhase({ status: status({ done: ["beats"] }), ...settled }))).toBe(true);
    expect(isPolling(analyzePhase({ status: null, ...settled }))).toBe(true);
  });

  test("no job at all resolves to NOT ANALYSED — after a grace period for the race with the POST", () => {
    const never = status({ status: null });
    // The POST that queues the job is fired without being awaited, so an early null is a race.
    expect(analyzePhase({ status: never, consecutiveMissingJob: 1, consecutiveQueued: 0, consecutiveErrors: 0 })).toBe(
      "analysing",
    );
    const phase = analyzePhase({ status: never, consecutiveMissingJob: 4, consecutiveQueued: 0, consecutiveErrors: 0 });
    expect(phase).toBe("not-started");
    expect(isPolling(phase)).toBe(false);
  });

  test("an unreadable route stops the poll instead of hammering it forever", () => {
    expect(
      isPolling(analyzePhase({ status: null, consecutiveMissingJob: 0, consecutiveQueued: 0, consecutiveErrors: 4 })),
    ).toBe(true);
    const phase = analyzePhase({ status: null, consecutiveMissingJob: 0, consecutiveQueued: 0, consecutiveErrors: 5 });
    expect(phase).toBe("unreachable");
    expect(isPolling(phase)).toBe(false);
  });

  test("the denominator is the asset's REAL branch count — the '3/4' that never completed", () => {
    // Rendered, not inferred: this is the number a user reads. `faces` was in the hardcoded list of
    // four and its pipeline is cut, so the count could never reach its total and the poll could never
    // stop. The COPY changed with ART-DIRECTION §13 — one sentence instead of a segmented rail, three
    // uppercase-mono pills and a 9px counter under the 12px floor — but the property under test is
    // the arithmetic, and it is asserted on the count rather than on the wording.
    const video = renderToStaticMarkup(createElement(AnalyzeProgress, { assetId: "a1", kind: "video" }));
    expect(video).toContain("of 3");
    expect(video).not.toContain("of 4");

    // Audio has no shots, so it counts against two — and now renders at all, which it never did.
    const audio = renderToStaticMarkup(createElement(AnalyzeProgress, { assetId: "a1", kind: "audio" }));
    expect(audio).toContain("of 2");
    expect(audio).not.toContain("of 3");
  });

  test("the branch NAMES are never printed — 'beats' would advertise a capability this build lacks", () => {
    // The beats branch runs; nothing consumes it (`planBeatCuts` returns `{ bpm: 0, cutTicks: [] }`).
    // A readout that says HITE is "working out beats" is an invitation to the one prompt the brief
    // bans by name, issued by the product itself.
    for (const kind of ["video", "audio"] as const) {
      const html = renderToStaticMarkup(createElement(AnalyzeProgress, { assetId: "a1", kind })).toLowerCase();
      for (const name of ["beat", "scene", "transcrib", "face"]) {
        expect(html, `${kind} names "${name}"`).not.toContain(name);
      }
    }
  });

  test("a finished analysis says nothing at all — a readout that reports success is chrome", () => {
    // §13's rule about the timecode, applied to the one background process worth mentioning: it is
    // on screen while it is true and gone the moment it is not.
    const done = analyzePhase({
      status: status({ branches: ["transcribe"], done: ["transcribe"], status: "succeeded" }),
      ...settled,
    });
    expect(done).toBe("complete");
    expect(isPolling(done)).toBe(false);
  });

  test("a job nothing ever claims says so, instead of counting 0 of 3 forever", () => {
    // The queue has no answer for this case by design: `reap_stale_jobs` only moves rows that are
    // RUNNING with a dead heartbeat, so a job no worker ever claimed stays `queued` for the life of
    // the tab. Almost always that means `pnpm worker` is not running, and nothing on screen said so.
    const queued = status({ status: "queued" });
    const ticks = Math.ceil(WORKER_IDLE_HINT_MS / 1500);

    // Short waits are just a wait: a worker polls the queue every 2 s by default.
    expect(analyzePhase({ status: queued, ...settled, consecutiveQueued: ticks - 1 })).toBe("analysing");

    const phase = analyzePhase({ status: queued, ...settled, consecutiveQueued: ticks });
    expect(phase).toBe("unclaimed");
    // It is a hint, NOT a client-side timeout: the poll keeps running, so starting the worker
    // clears the line on the next tick.
    expect(isPolling(phase)).toBe(true);
    // And a job that IS being worked on never reaches it, however long the render takes.
    expect(analyzePhase({ status: status({ status: "running" }), ...settled, consecutiveQueued: ticks * 10 })).toBe(
      "analysing",
    );
  });

  test("the hint names the process that would do the work, and claims no fault", () => {
    expect(WORKER_IDLE_HINT).toContain("pnpm worker");
    // Non-alarming: it reports what has not happened, it does not declare the job failed.
    expect(WORKER_IDLE_HINT.toLowerCase()).not.toMatch(/fail|error|stuck|broken/);
  });

  test("no branch list the route can produce leaves the poll unable to finish", () => {
    // The regression, stated as the property that failed: for EVERY asset kind the route answers
    // for, the completed state has to be reachable.
    for (const kind of ["video", "audio"] as const) {
      const branches = analysisBranchesForKind(kind);
      const phase = analyzePhase({ status: status({ branches, done: branches }), ...settled });
      expect(isPolling(phase), `${kind} never finishes`).toBe(false);
    }
  });
});
