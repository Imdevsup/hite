import { describe, expect, test, beforeEach, vi, afterEach } from "vitest";

// Stub fetch so the debounced autosave doesn't make network calls.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

import { useEditor, loadAssets, hydrateProject, flushManualEdits, type Asset } from "./store";
import { appendAssetToTimeline, addMarkerAtPlayhead } from "./actions";
import { isClip } from "@/lib/edl/query";
import type { Edl } from "@/lib/edl/schema";
import type { EditCommand } from "@/lib/edl/commands";

const ASSET: Asset = {
  id: "00000000-0000-0000-0000-000000000001",
  kind: "video",
  blob_url: "https://blob/x",
  filename: "x.mp4",
  duration_ms: 30_000,
  width: 1920,
  height: 1080,
  fps: 30,
};

/** The project the current test is "in" — reset() moves to a new one each time. */
let projectId = "p0";
let projectSeq = 0;

function reset() {
  // Hydrating a NEW project id is the public reset path, and the only one that also clears the
  // module-level undo history + any pending autosave (a bare setState can't reach either).
  projectId = `p${++projectSeq}`;
  hydrateProject({ projectId, assets: [], edl: null });
}
const clips = (e: Edl) => e.tracks.flatMap((t) => t.items.filter(isClip));

const EFFECT = (key: string): EditCommand[] =>
  [{ type: "ADD_EFFECT", target: "all", effectKey: key, params: {} }] as EditCommand[];

/** Install a clean fetch spy for a test that asserts on what was POSTed. Call AFTER hydrating, so a
 *  flush left over from the previous test can't land in this test's call log. */
function stubFetch(response: { ok: boolean; status: number } = { ok: true, status: 200 }) {
  const mock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

interface EditPost {
  projectId: string;
  edl: Edl;
  rationale: string;
}
/** The bodies of every POST /api/edits the spy saw, in order. */
function editPosts(mock: ReturnType<typeof vi.fn>): EditPost[] {
  return mock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)) as EditPost);
}

describe("editor store — assets + seed", () => {
  beforeEach(reset);

  test("loadAssets sets primary to the first video", () => {
    loadAssets(projectId, [{ ...ASSET, id: "a1", kind: "audio" }, { ...ASSET, id: "a2", kind: "video" }]);
    expect(useEditor.getState().primaryAsset?.id).toBe("a2");
  });

  test("addAsset seeds an Edl.2 (ticks) with one clip", () => {
    useEditor.getState().addAsset(ASSET);
    const e = useEditor.getState().edl!;
    expect(e.schema).toBe("Edl.2");
    expect(clips(e)).toHaveLength(1);
    expect(e.durationTicks).toBe(900_000); // 30000ms * 30 ticks/ms
  });
});

describe("editor store — dispatch + history", () => {
  beforeEach(() => {
    reset();
    useEditor.getState().addAsset(ASSET);
  });

  test("dispatch ADD_EFFECT routes through the reducer + enables undo", () => {
    const ok = useEditor.getState().dispatch([{ type: "ADD_EFFECT", target: "all", effectKey: "saturation-up", params: {} }] as EditCommand[]);
    expect(ok).toBe(true);
    expect(clips(useEditor.getState().edl!)[0].effects).toHaveLength(1);
    expect(useEditor.getState().canUndo).toBe(true);
  });

  test("undo reverts; redo re-applies", () => {
    useEditor.getState().dispatch([{ type: "ADD_EFFECT", target: "all", effectKey: "x", params: {} }] as EditCommand[]);
    useEditor.getState().undo();
    expect(clips(useEditor.getState().edl!)[0].effects).toHaveLength(0);
    expect(useEditor.getState().canRedo).toBe(true);
    useEditor.getState().redo();
    expect(clips(useEditor.getState().edl!)[0].effects).toHaveLength(1);
  });

  test("splitAtPlayhead splits the clip under the playhead", () => {
    useEditor.getState().seekTo(10_000);
    useEditor.getState().splitAtPlayhead();
    expect(clips(useEditor.getState().edl!)).toHaveLength(2);
  });

  test("splitAtPlayhead splits the SELECTED clip's lane on a multi-video-track timeline", () => {
    // Seed track_0 holds the primary clip [0,900000). Add a clip on a SECOND video track that also
    // overlaps the playhead, so clipAtTick() (track-order-first) would otherwise hit track_0.
    useEditor.getState().dispatch([
      { type: "ADD_CLIP", assetId: ASSET.id, trackId: "track_1", atTick: 0, inTick: 0, outTick: 900_000 },
    ] as EditCommand[]);
    const tracks = useEditor.getState().edl!.tracks;
    expect(tracks).toHaveLength(2);
    const t1ClipId = tracks[1].items.filter(isClip)[0].id;

    // Select the second-track clip and split at a tick inside both lanes.
    useEditor.getState().selectClip(t1ClipId);
    useEditor.getState().seekTo(10_000);
    useEditor.getState().splitAtPlayhead();

    const after = useEditor.getState().edl!.tracks;
    // The SELECTED lane (track_1) split → 2 clips; the other lane (track_0) is untouched → 1 clip.
    expect(after[0].items.filter(isClip)).toHaveLength(1);
    expect(after[1].items.filter(isClip)).toHaveLength(2);
  });

  test("splitAtPlayhead falls back to the clip under the playhead when the selection is elsewhere", () => {
    // Selecting a clip but parking the playhead OUTSIDE it must not no-op or split the wrong thing —
    // it splits whatever clip the playhead is actually over (single-track behaviour is preserved).
    const id = clips(useEditor.getState().edl!)[0].id;
    useEditor.getState().selectClip(id);
    useEditor.getState().seekTo(10_000); // inside the only clip
    useEditor.getState().splitAtPlayhead();
    expect(clips(useEditor.getState().edl!)).toHaveLength(2);
  });

  test("rippleDelete removes the selected clip", () => {
    useEditor.getState().seekTo(10_000);
    useEditor.getState().splitAtPlayhead();
    const id = clips(useEditor.getState().edl!)[0].id;
    useEditor.getState().selectClip(id);
    useEditor.getState().rippleDelete();
    expect(clips(useEditor.getState().edl!)).toHaveLength(1);
    expect(useEditor.getState().selectedClipId).toBeNull();
  });

  test("transport state setters work", () => {
    useEditor.getState().seekTo(1234);
    expect(useEditor.getState().currentTimeMs).toBe(1234);
    useEditor.getState().togglePlay();
    expect(useEditor.getState().isPlaying).toBe(true);
  });

  test("applyAiEdl makes the AI turn undoable (does not reset history)", () => {
    // Start from a real edit so there's a populated baseline + history controller.
    useEditor.getState().dispatch([{ type: "ADD_EFFECT", target: "all", effectKey: "a", params: {} }] as EditCommand[]);
    const baseline = useEditor.getState().edl!;
    expect(clips(baseline)[0].effects).toHaveLength(1);

    // Simulate an AI turn: server returns a full Edl.2 (here: baseline with a 2nd effect added).
    const aiEdl: Edl = {
      ...baseline,
      tracks: baseline.tracks.map((t) => ({
        ...t,
        items: t.items.map((it) =>
          isClip(it) ? { ...it, effects: [...it.effects, { ...it.effects[0], id: "fx_ai", effectKey: "b" }] } : it,
        ),
      })),
    };

    useEditor.getState().applyAiEdl(aiEdl);
    expect(clips(useEditor.getState().edl!)[0].effects).toHaveLength(2);
    expect(useEditor.getState().canUndo).toBe(true); // ← the bug: was false (history reset)

    // ⌘Z must revert the AI edit back to the baseline.
    useEditor.getState().undo();
    expect(clips(useEditor.getState().edl!)[0].effects).toHaveLength(1);
    expect(useEditor.getState().canRedo).toBe(true);
  });

  test("AI EDL stays referentially identical until superseded (the chat undo guard contract)", () => {
    // ChatWindow's per-turn Undo only fires if the LIVE edl is still the exact object the AI turn
    // applied (reference equality). This guards that assumption end-to-end.
    useEditor.getState().dispatch([{ type: "ADD_EFFECT", target: "all", effectKey: "a", params: {} }] as EditCommand[]);
    const baseline = useEditor.getState().edl!;

    const aiEdl: Edl = {
      ...baseline,
      tracks: baseline.tracks.map((t) => ({
        ...t,
        items: t.items.map((it) =>
          isClip(it) ? { ...it, effects: [...it.effects, { ...it.effects[0], id: "fx_ai", effectKey: "b" }] } : it,
        ),
      })),
    };
    useEditor.getState().applyAiEdl(aiEdl);
    // Right after the turn: live edl IS the applied object → guard passes, undo is allowed.
    expect(useEditor.getState().edl).toBe(aiEdl);

    // A later manual edit supersedes it → live edl is a NEW object → guard would refuse a stale undo.
    useEditor.getState().dispatch([{ type: "ADD_EFFECT", target: "all", effectKey: "c", params: {} }] as EditCommand[]);
    expect(useEditor.getState().edl).not.toBe(aiEdl);
  });

  test("applyAiEdl seeds when there is no baseline yet (AI made the first edit)", () => {
    reset(); // no edl, no history
    const fresh = useEditor.getState();
    expect(fresh.edl).toBeNull();
    // Build a minimal valid Edl.2 by seeding via addAsset then capturing it.
    fresh.addAsset(ASSET);
    const seeded = useEditor.getState().edl!;
    reset();
    useEditor.getState().applyAiEdl(seeded);
    expect(useEditor.getState().edl).not.toBeNull();
    // Seeding path: fresh baseline, nothing to undo yet.
    expect(useEditor.getState().canUndo).toBe(false);
  });
});

/**
 * The reducer fails LOUD; the manual path used to swallow that into a console.warn, so every
 * rejection (trim_collapses_clip, clip_exceeds_media, degenerate_clip…) reached the user as a button
 * that did nothing. `commandError` is what the chrome renders instead.
 */
describe("a refused command is reported, not swallowed", () => {
  beforeEach(() => {
    reset();
    useEditor.getState().addAsset(ASSET); // 30s asset → seed clip [0, 900000)
  });

  test("a trim that would collapse the clip names the reason", () => {
    const id = clips(useEditor.getState().edl!)[0].id;
    expect(
      useEditor.getState().dispatch([{ type: "TRIM_CLIP", clipId: id, edge: "out", toTick: 0 }] as EditCommand[]),
    ).toBe(false);
    expect(useEditor.getState().commandError).toContain("leaves < 1 tick");
  });

  test("a clip past the end of its media says so, and the next good edit clears it", () => {
    expect(
      useEditor.getState().dispatch([
        { type: "ADD_CLIP", assetId: ASSET.id, trackId: "track_0", atTick: 900_000, inTick: 0, outTick: 1_000_000 },
      ] as EditCommand[]),
    ).toBe(false);
    expect(useEditor.getState().commandError).toContain("past asset");
    expect(clips(useEditor.getState().edl!)).toHaveLength(1); // the batch rolled back whole

    expect(useEditor.getState().dispatch(EFFECT("a"))).toBe(true);
    expect(useEditor.getState().commandError).toBeNull();
  });

  test("switching projects clears a rejection from the previous one", () => {
    const id = clips(useEditor.getState().edl!)[0].id;
    useEditor.getState().dispatch([{ type: "TRIM_CLIP", clipId: id, edge: "in", toTick: 900_000 }] as EditCommand[]);
    expect(useEditor.getState().commandError).not.toBeNull();
    hydrateProject({ projectId: "fresh", assets: [], edl: null });
    expect(useEditor.getState().commandError).toBeNull();
  });
});

describe("appendAssetToTimeline — the manual multi-clip path (ADD_CLIP from the bin)", () => {
  beforeEach(reset);

  test("appends a second uploaded video to the END of the main track, same lane", () => {
    useEditor.getState().addAsset(ASSET); // seeds track_0 with clip [0,900000)
    const second: Asset = { ...ASSET, id: "00000000-0000-0000-0000-000000000002", filename: "b.mp4", duration_ms: 10_000 };
    useEditor.getState().addAsset(second); // a 2nd upload does NOT auto-seed (edl exists)
    expect(clips(useEditor.getState().edl!)).toHaveLength(1);

    const ok = appendAssetToTimeline(second.id);
    expect(ok).toBe(true);
    const e = useEditor.getState().edl!;
    expect(e.tracks).toHaveLength(1); // same lane — no second video track (v1 invariant)
    const cs = clips(e);
    expect(cs).toHaveLength(2);
    expect(cs[1].assetId).toBe(second.id);
    // It abuts the first clip's tail: starts where the seed clip ends, runs its own 10s source.
    expect(e.durationTicks).toBe(900_000 + 300_000); // 30s + 10s @ 30 ticks/ms
    expect(useEditor.getState().canUndo).toBe(true); // undoable like any dispatch
  });

  test("refuses when the asset's duration isn't probed yet (returns false, no clip added)", () => {
    useEditor.getState().addAsset(ASSET);
    const unprobed: Asset = { ...ASSET, id: "00000000-0000-0000-0000-000000000003", duration_ms: null };
    useEditor.getState().addAsset(unprobed);
    expect(appendAssetToTimeline(unprobed.id)).toBe(false);
    expect(clips(useEditor.getState().edl!)).toHaveLength(1);
  });

  test("an image asset (no duration) appends with a default span", () => {
    useEditor.getState().addAsset(ASSET);
    const img: Asset = { ...ASSET, id: "00000000-0000-0000-0000-000000000004", kind: "image", filename: "c.png", duration_ms: null };
    useEditor.getState().addAsset(img);
    expect(appendAssetToTimeline(img.id)).toBe(true);
    const cs = clips(useEditor.getState().edl!);
    expect(cs).toHaveLength(2);
    expect(cs[1].assetId).toBe(img.id);
  });

  test("refuses an unknown asset id and an audio asset (audio is a bed, not a timeline clip)", () => {
    useEditor.getState().addAsset(ASSET);
    expect(appendAssetToTimeline("does-not-exist")).toBe(false);
    const audio: Asset = { ...ASSET, id: "00000000-0000-0000-0000-000000000005", kind: "audio" };
    useEditor.getState().addAsset(audio);
    expect(appendAssetToTimeline(audio.id)).toBe(false);
    expect(clips(useEditor.getState().edl!)).toHaveLength(1);
  });
});

describe("addMarkerAtPlayhead — manual marker create path (now that the Timeline shows them)", () => {
  beforeEach(reset);

  test("drops a marker at the playhead tick, auto-titled by timecode", () => {
    useEditor.getState().addAsset(ASSET);
    useEditor.getState().seekTo(75_000); // 1:15
    expect(addMarkerAtPlayhead()).toBe(true);
    const ms = useEditor.getState().edl!.markers;
    expect(ms).toHaveLength(1);
    expect(ms[0].atTick).toBe(75_000 * 30); // ticks @ 30/ms
    expect(ms[0].title).toBe("Marker 1:15");
    expect(ms[0].kind).toBe("comment");
    expect(useEditor.getState().canUndo).toBe(true);
  });

  test("honors an explicit title and is a no-op with no EDL", () => {
    expect(addMarkerAtPlayhead("Drop")).toBe(false); // no edl yet
    useEditor.getState().addAsset(ASSET);
    expect(addMarkerAtPlayhead("Drop")).toBe(true);
    expect(useEditor.getState().edl!.markers[0].title).toBe("Drop");
  });
});

/**
 * P0 `stale-edl-cross-project`. The store is a module singleton and client-side navigation between
 * projects never tore it down: project B rendered A's timeline and B's first edit POSTed A's cut to
 * B. These replay the audit's probe — edit A, open a fresh B, then try to edit.
 */
describe("project switch — A's timeline must never follow the user into B", () => {
  beforeEach(reset);

  test("opening a project with no saved edit clears the previous project's EDL, history and selection", async () => {
    vi.useFakeTimers();
    hydrateProject({ projectId: "A", assets: [ASSET], edl: null });
    const fetchMock = stubFetch();

    useEditor.getState().selectClip(clips(useEditor.getState().edl!)[0].id);
    expect(useEditor.getState().dispatch(EFFECT("a"))).toBe(true);
    await vi.advanceTimersByTimeAsync(600); // A's autosave lands
    const aEdl = useEditor.getState().edl!;
    expect(editPosts(fetchMock).map((p) => p.projectId)).toEqual(["A"]);

    // Client-side nav to a fresh project: no saved edit, assets not loaded yet.
    hydrateProject({ projectId: "B", assets: [], edl: null });
    const s = useEditor.getState();
    expect(s.projectId).toBe("B");
    expect(s.edl).toBeNull();
    expect(s.assets).toEqual([]);
    expect(s.primaryAsset).toBeNull();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    expect(s.selectedClipId).toBeNull();

    // Pressing S / any edit on B must not resurrect A's timeline…
    useEditor.getState().splitAtPlayhead();
    expect(useEditor.getState().dispatch(EFFECT("b"))).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);

    // …and nothing is ever written for B — least of all A's cut.
    const posted = editPosts(fetchMock);
    expect(posted).toHaveLength(1);
    expect(posted[0].projectId).toBe("A");
    expect(posted.some((p) => p.projectId === "B")).toBe(false);
    expect(posted.some((p) => p.edl.contentHash === aEdl.contentHash && p.projectId !== "A")).toBe(false);
  });

  test("an edit still inside the debounce window when the user navigates saves to its OWN project", async () => {
    vi.useFakeTimers();
    hydrateProject({ projectId: "A", assets: [ASSET], edl: null });
    const fetchMock = stubFetch();

    expect(useEditor.getState().dispatch(EFFECT("a"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled(); // still debounced

    hydrateProject({ projectId: "B", assets: [], edl: null }); // nav before the 500ms elapses
    expect(fetchMock).toHaveBeenCalledTimes(1); // flushed at the switch, not left on a timer
    await vi.advanceTimersByTimeAsync(2000);

    const posted = editPosts(fetchMock);
    expect(posted).toHaveLength(1);
    expect(posted[0].projectId).toBe("A"); // flushed to the project it came from, not relabelled B
  });
});

/** P1 `silent-autosave-loss` + `unload-flush-not-keepalive`. */
describe("autosave failure — bounded retry, honest state, unload-proof flush", () => {
  beforeEach(reset);

  test("a failing save retries three times, then reports saveState 'error' with the reason", async () => {
    vi.useFakeTimers();
    hydrateProject({ projectId: "A", assets: [ASSET], edl: null });
    const fetchMock = stubFetch({ ok: false, status: 401 }); // e.g. the session expired mid-session

    expect(useEditor.getState().dispatch(EFFECT("a"))).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(useEditor.getState().saveState).toBe("saving");

    await vi.advanceTimersByTimeAsync(5000); // 600ms + 1200ms of backoff
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(useEditor.getState().saveState).toBe("error");
    expect(useEditor.getState().saveError).toContain("401");

    // The payload was NOT dropped: the unload flush retries it, with keepalive so the browser can't
    // cancel it as the document tears down.
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await flushManualEdits({ keepalive: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect((fetchMock.mock.calls[3][1] as RequestInit).keepalive).toBe(true);
    expect(editPosts(fetchMock)[3].projectId).toBe("A");
    expect(useEditor.getState().saveState).toBe("saved");
    expect(useEditor.getState().saveError).toBeNull();
  });

  test("a failure on the project you LEFT never becomes the state of the project you opened", async () => {
    // The persister is a module singleton and its retries outlive the navigation, so A's failed save
    // used to report `error` into B's state — and ChatWindow refuses to plan while saveState is
    // 'error', i.e. a project the user never edited answered every AI turn with "your changes
    // aren't saved". The payload still POSTs to A (never relabelled); only the STATUS is dropped.
    vi.useFakeTimers();
    hydrateProject({ projectId: "A", assets: [ASSET], edl: null });
    const fetchMock = stubFetch({ ok: false, status: 500 });

    expect(useEditor.getState().dispatch(EFFECT("a"))).toBe(true);
    await vi.advanceTimersByTimeAsync(5000); // 3 attempts, all failing
    expect(useEditor.getState().saveState).toBe("error");

    hydrateProject({ projectId: "B", assets: [ASSET], edl: null }); // flushes A's requeued payload
    expect(useEditor.getState().saveState).toBe("saved");
    await vi.advanceTimersByTimeAsync(5000); // …and lets A's re-flush fail again, in the background

    expect(useEditor.getState().saveState).toBe("saved");
    expect(useEditor.getState().saveError).toBeNull();
    expect(editPosts(fetchMock).map((p) => p.projectId)).toEqual(Array(6).fill("A"));
  });

  test("flushManualEdits sends the pending edit immediately (what chat submit awaits before planning)", async () => {
    vi.useFakeTimers();
    hydrateProject({ projectId: "A", assets: [ASSET], edl: null });
    const fetchMock = stubFetch();

    useEditor.getState().nudgeTrim("out", -1000); // no selection → no command
    useEditor.getState().selectClip(clips(useEditor.getState().edl!)[0].id);
    expect(useEditor.getState().dispatch(EFFECT("a"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    await flushManualEdits();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(editPosts(fetchMock)[0].edl.contentHash).toBe(useEditor.getState().edl!.contentHash);
    expect(useEditor.getState().saveState).toBe("saved");
  });
});

/** P2 `corrupt-edl-silently-dropped`: a saved edit that won't parse must not be buried. */
describe("a saved edit that failed to load blocks autosave", () => {
  beforeEach(reset);

  test("edits still apply locally but never overwrite the version that failed to load", async () => {
    vi.useFakeTimers();
    hydrateProject({
      projectId: "C",
      assets: [ASSET],
      edl: null,
      edlLoadError: "couldn't load your last saved edit (v7)",
    });
    const fetchMock = stubFetch();
    expect(useEditor.getState().edlLoadError).toContain("v7");
    expect(useEditor.getState().edl).not.toBeNull(); // the asset still seeds a usable timeline

    expect(useEditor.getState().dispatch(EFFECT("a"))).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);

    expect(fetchMock).not.toHaveBeenCalled(); // v7 stays the latest version
    expect(useEditor.getState().saveState).toBe("error");
    expect(useEditor.getState().saveError).toContain("not saving");

    // Re-opening a project whose edit loads fine clears the block.
    hydrateProject({ projectId: "D", assets: [ASSET], edl: null });
    expect(useEditor.getState().edlLoadError).toBeNull();
    expect(useEditor.getState().dispatch(EFFECT("b"))).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(editPosts(fetchMock).map((p) => p.projectId)).toEqual(["D"]);
  });
});

/** P2 `trim-extend-silent-noop`: the store owns the asset durations the pure reducer can't look up. */
describe("dispatch feeds real asset durations to the reducer", () => {
  beforeEach(reset);

  test("a clip minted over part of an asset can still be trimmed out to the real media end", () => {
    hydrateProject({ projectId: "E", assets: [ASSET], edl: null }); // 30s asset → seed clip [0, 900000)

    // Append a clip using only the first 10s of that same 30s asset.
    expect(
      useEditor.getState().dispatch([
        { type: "ADD_CLIP", assetId: ASSET.id, trackId: "track_0", atTick: 900_000, inTick: 0, outTick: 300_000 },
      ] as EditCommand[]),
    ).toBe(true);
    const minted = clips(useEditor.getState().edl!)[1];
    expect(minted.mediaRefs.full.availableOutTick).toBe(900_000); // the real media, not its own out point

    // …so "extend that clip by 2s" extends it instead of being refused at its own out point.
    useEditor.getState().selectClip(minted.id);
    useEditor.getState().nudgeTrim("out", 2000);
    expect(clips(useEditor.getState().edl!)[1].outTick).toBe(360_000);
  });
});
