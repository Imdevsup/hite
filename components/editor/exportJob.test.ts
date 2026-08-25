import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { describeExportFailure, renderStage, useExportJob } from "./exportJob";
import { JobTimeoutError } from "@/worker/deadline";
import { WORKER_IDLE_HINT_MS } from "@/lib/jobs/types";
import type { Edl } from "@/lib/edl/schema";

/**
 * The store holds the rendered EDL BY REFERENCE and never reads a field off it, so these cases only
 * need a distinguishable object identity — building a schema-valid Edl would test nothing extra and
 * would hide the one property under test behind fixture noise. Hence the cast, and only here.
 */
const edlRef = (tag: string): Edl => ({ tag } as unknown as Edl);

/**
 * TWO THINGS ARE UNDER TEST, and both were real failures of the old component-local export state.
 *
 * 1. CLOSING THE PANEL FORGOT THE RENDER. `status`/`progress`/`url` lived in `ExportWindow` and the
 *    poll was cleared on unmount, so closing the panel during a multi-minute sandbox render left the
 *    job running server-side with nothing in the browser tracking it. Reopening showed "RENDER ▸".
 *    The job's identity has always been in the database; the only thing the browser had to keep was
 *    WHICH id to ask about.
 *
 * 2. "RENDER FAILED — CHECK LOGS". Addressed to an engineer who does not exist: a HITE user has no
 *    logs and no way to get any.
 *
 * The store's poll is exercised against a stubbed fetch + fake timers, so "the render survives the
 * panel closing" is asserted by running it, not by reading the code.
 */

function stubBrowser() {
  const map = new Map<string, string>();
  const localStorage = {
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => { map.set(k, v); }),
    removeItem: vi.fn((k: string) => { map.delete(k); }),
  };
  vi.stubGlobal("window", { localStorage });
  return { map, localStorage };
}

beforeEach(() => {
  vi.useFakeTimers();
  stubBrowser();
  useExportJob.getState().reset();
});

afterEach(() => {
  useExportJob.getState().reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Advance fake timers and let the awaited fetch inside each tick settle. */
async function tick(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("renderStage", () => {
  test("names the coarse stage the backend actually reports — never a percentage", () => {
    expect(renderStage(0)).toBe("Queued");
    expect(renderStage(0.05)).toBe("Queued");
    expect(renderStage(0.5)).toBe("Rendering");
    expect(renderStage(1)).toBe("Finalizing");
  });
});

describe("the render survives the panel closing", () => {
  test("polling continues after the component that started it is gone, and lands the download", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/render") {
        return new Response(JSON.stringify({ exportId: "exp-1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "running", progress: 0.5 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await useExportJob.getState().start("proj-1", "16:9", null);
    expect(useExportJob.getState().status).toBe("running");
    expect(useExportJob.getState().exportId).toBe("exp-1");

    // The panel unmounts here. Nothing is torn down: the store owns the interval, not a component.
    await tick(1600);
    expect(useExportJob.getState().progress).toBe(0.5);

    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ status: "succeeded", progress: 1 }), { status: 200 }),
    );
    await tick(1600);

    const state = useExportJob.getState();
    expect(state.status).toBe("done");
    // The same-origin download route, which re-signs per click — never the worker's week-long url.
    expect(state.downloadUrl).toBe("/api/export/exp-1");
  });

  test("the export id is written to storage while running and cleared once it settles", async () => {
    const { localStorage } = stubBrowser();
    let status = "running";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/render"
        ? new Response(JSON.stringify({ exportId: "exp-2" }), { status: 200 })
        : new Response(JSON.stringify({ status, progress: 0.5 }), { status: 200 }),
    ));

    await useExportJob.getState().start("proj-9", "9:16", null);
    // This one line is what lets a render survive a full page reload, not just a panel close.
    expect(localStorage.setItem).toHaveBeenCalledWith("hite.export.v1", JSON.stringify({ projectId: "proj-9", exportId: "exp-2" }));

    status = "succeeded";
    await tick(1600);
    expect(localStorage.removeItem).toHaveBeenCalledWith("hite.export.v1");
  });

  test("resume re-attaches to a stored job and reads its CURRENT state from the server", async () => {
    const { map } = stubBrowser();
    map.set("hite.export.v1", JSON.stringify({ projectId: "proj-3", exportId: "exp-3" }));
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: "succeeded", progress: 1 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    useExportJob.getState().resume("proj-3");
    // The first read is immediate, so reopening does not manufacture 1.5s of fake "Queued".
    await tick(0);

    expect(fetchMock).toHaveBeenCalledWith("/api/render/exp-3");
    expect(useExportJob.getState().status).toBe("done");
  });

  test("resume ignores a job that belongs to a different project", async () => {
    const { map } = stubBrowser();
    map.set("hite.export.v1", JSON.stringify({ projectId: "someone-elses", exportId: "exp-x" }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    useExportJob.getState().resume("proj-3");
    await tick(0);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useExportJob.getState().status).toBe("idle");
  });

  test("resume DROPS a live job from another project rather than leaving it readable", async () => {
    // The regression: the store is a module singleton and survives client-side navigation, so a
    // render started in project A stayed in it when the router swapped to project B. B's panel then
    // read A's job — a running strip, a disabled RENDER, and eventually A's video behind B's
    // download button. `resume` now clears a foreign job; the render is untouched on the server.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/render"
        ? new Response(JSON.stringify({ exportId: "exp-a" }), { status: 200 })
        : new Response(JSON.stringify({ status: "running", progress: 0.5 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await useExportJob.getState().start("proj-a", "16:9", edlRef("a"));
    await tick(1600);
    expect(useExportJob.getState().status).toBe("running");

    useExportJob.getState().resume("proj-b");
    const state = useExportJob.getState();
    expect(state.status).toBe("idle");
    expect(state.projectId).toBeNull();
    expect(state.exportId).toBeNull();
    expect(state.sourceEdl).toBeNull();

    // And it stopped asking about A's render — the interval is cleared, not merely ignored.
    const seen = fetchMock.mock.calls.length;
    await tick(1600 * 3);
    expect(fetchMock.mock.calls.length).toBe(seen);
  });

  test("a foreign running job does not swallow the press of another project's RENDER", async () => {
    // `start` used to bail on `status === "running"` alone, so with A's job still in the store B's
    // RENDER button did nothing at all when pressed.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/render"
        ? new Response(JSON.stringify({ exportId: "exp-b" }), { status: 200 })
        : new Response(JSON.stringify({ status: "running", progress: 0.5 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await useExportJob.getState().start("proj-a", "16:9", edlRef("a"));
    await useExportJob.getState().start("proj-b", "9:16", edlRef("b"));

    const state = useExportJob.getState();
    expect(state.projectId).toBe("proj-b");
    expect(state.exportId).toBe("exp-b");
    expect(state.status).toBe("running");
  });

  test("the finished job remembers WHICH cut it rendered, so a stale download can say so", async () => {
    const renderedEdl = edlRef("rendered");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/render"
        ? new Response(JSON.stringify({ exportId: "exp-6" }), { status: 200 })
        : new Response(JSON.stringify({ status: "succeeded", progress: 1 }), { status: 200 }),
    ));

    await useExportJob.getState().start("proj-6", "16:9", renderedEdl);
    await tick(1600);

    expect(useExportJob.getState().status).toBe("done");
    // Reference identity is the comparison the panel makes: the store swaps the whole EDL object on
    // every dispatch, so "same object" is exactly "the timeline has not changed since".
    expect(useExportJob.getState().sourceEdl).toBe(renderedEdl);
    expect(useExportJob.getState().sourceEdl).not.toBe(edlRef("rendered"));
  });

  test("a job resumed after a reload does not claim to match the current timeline", async () => {
    // The rendered EDL object died with the old page. Reporting `null` makes the panel warn that the
    // file may be out of date, which is the safe direction to be wrong in.
    const { map } = stubBrowser();
    map.set("hite.export.v1", JSON.stringify({ projectId: "proj-7", exportId: "exp-7" }));
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ status: "succeeded", progress: 1 }), { status: 200 }),
    ));

    useExportJob.getState().resume("proj-7");
    await tick(0);
    expect(useExportJob.getState().sourceEdl).toBeNull();
  });

  test("a failed job stops the poll and carries the engine's real reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/render"
        ? new Response(JSON.stringify({ exportId: "exp-4" }), { status: 200 })
        : new Response(JSON.stringify({ status: "failed", error: "ffmpeg exited 1: no such file" }), { status: 200 }),
    ));

    await useExportJob.getState().start("proj-4", "1:1", null);
    await tick(1600);

    const state = useExportJob.getState();
    expect(state.status).toBe("failed");
    expect(state.failure?.detail).toBe("ffmpeg exited 1: no such file");
  });

  test("an unreadable status route gives up cleanly instead of spinning forever", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/render") return new Response(JSON.stringify({ exportId: "exp-5" }), { status: 200 });
      calls += 1;
      return new Response("nope", { status: 500 });
    }));

    await useExportJob.getState().start("proj-5", "16:9", null);
    await tick(1600 * 8);

    expect(useExportJob.getState().status).toBe("failed");
    // It stopped asking — the interval is cleared, not merely ignored.
    const seen = calls;
    await tick(1600 * 3);
    expect(calls).toBe(seen);
  });
});

describe("a render nothing ever claims", () => {
  test("says so after a wait, and takes it back the moment a worker picks the job up", async () => {
    // Nothing server-side ever contradicts a `queued` row: the reaper only moves RUNNING jobs whose
    // heartbeat stopped. Without this the control reads "Queued" for the life of the tab when
    // `pnpm worker` is not running — the single easiest step to forget.
    let body = { status: "queued", progress: 0.05 };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/render") return new Response(JSON.stringify({ exportId: "exp-q" }), { status: 200 });
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await useExportJob.getState().start("proj-1", "16:9", null);
    // The first poll answers immediately; a job queued for one tick is just a job in a queue.
    expect(useExportJob.getState().waitingForWorker).toBe(false);

    await tick(WORKER_IDLE_HINT_MS + 1600);
    expect(useExportJob.getState().waitingForWorker).toBe(true);
    // A hint, not a verdict: the job is still running as far as the store is concerned.
    expect(useExportJob.getState().status).toBe("running");

    body = { status: "running", progress: 0.5 };
    await tick(1600);
    expect(useExportJob.getState().waitingForWorker).toBe(false);
  });
});

describe("describeExportFailure — written for a person, not for a log reader", () => {
  test("the generic case never tells the user to check logs they do not have", () => {
    const failure = describeExportFailure("boom");
    expect(failure.headline).toBe("The render stopped before it finished.");
    expect(`${failure.headline} ${failure.advice}`.toLowerCase()).not.toContain("check logs");
    expect(failure.advice).toMatch(/nothing on your timeline was lost/i);
  });

  test("the engine's message is preserved as detail, never as the message", () => {
    const failure = describeExportFailure("Error: ENOENT open '/tmp/x.mp4'");
    expect(failure.detail).toBe("Error: ENOENT open '/tmp/x.mp4'");
    expect(failure.headline).not.toContain("ENOENT");
  });

  test("the worker's REAL timeout message is classified as a timeout, not as the generic stop", () => {
    // This case was "covered" by a hand-written string the worker never emits ("handler timed out
    // after 300s"), while the error it actually writes into `job.error` said "was still running
    // after 900s and was given up on" — which matches none of the keywords below it, so every real
    // timeout reached the user as "The render stopped before it finished." The producer is
    // constructed here rather than quoted, so a reworded message fails this test instead of quietly
    // falling through to the generic branch again.
    const real = new JobTimeoutError("the render", 60 * 60_000).message;
    expect(describeExportFailure(real).headline).toMatch(/out of time/i);
    expect(describeExportFailure(real).detail).toBe(real);
  });

  test("recognisable causes get advice that is actually actionable", () => {
    expect(describeExportFailure("JavaScript heap out of memory").headline).toMatch(/out of memory/i);
    // The instruction has to name a control that EXISTS. It said "re-upload the clip in the Media
    // panel" until ART-DIRECTION §13 deleted the Media panel along with the other ten; advice that
    // sends a user to a window nobody can open is the dead-button class in prose form.
    const missing = describeExportFailure("no such file or directory").advice;
    expect(missing).toMatch(/drop the clip/i);
    expect(missing.toLowerCase()).not.toContain("panel");
  });

  test("no message at all still produces a sentence and an empty detail", () => {
    const failure = describeExportFailure(null);
    expect(failure.headline.length).toBeGreaterThan(0);
    expect(failure.detail).toBeNull();
    expect(describeExportFailure("   ").detail).toBeNull();
  });
});
