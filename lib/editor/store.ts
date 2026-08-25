"use client";
import { create } from "zustand";
import { emptyEdl2, type Edl } from "@/lib/edl/schema";
import { EditHistory } from "@/lib/edl/history";
import { CommandError } from "@/lib/edl/reducer";
import type { EditCommand } from "@/lib/edl/commands";
import { msToTicks } from "@/lib/edl/time";
import { clipAtTick, locateClip } from "@/lib/edl/query";
import { createDebouncedPersister, type PersistStatus } from "@/lib/persist/debounce";

export interface Asset {
  id: string;
  kind: "video" | "audio" | "image";
  blob_url: string;
  filename: string;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
}

interface EditorStore {
  projectId: string | null;
  assets: Asset[];
  primaryAsset: Asset | null;
  edl: Edl | null; // Edl.2 — the single source of truth, mutated ONLY via dispatch()
  currentTimeMs: number; // UI/transport unit; converted to ticks at command edges
  isPlaying: boolean;
  selectedClipId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Autosave lifecycle. 'error' = the last save failed every attempt, so the DB is BEHIND the screen. */
  saveState: PersistStatus;
  /** Why the last save failed (null while saving/saved). Rendered by the chrome; never swallowed. */
  saveError: string | null;
  /**
   * Set when this project HAS a saved edit that failed to parse/migrate on load. The timeline on
   * screen is then not the user's real cut, so autosave is BLOCKED while this is set — otherwise the
   * first edit appends a new "latest" version on top of a good one that only DB surgery could reach.
   */
  edlLoadError: string | null;
  /**
   * Why the LAST dispatch was refused, cleared by the next one that applies. The reducer fails loud
   * (trim_collapses_clip, clip_exceeds_media, degenerate_clip…) but the manual path swallowed that
   * into a console.warn, so a refused edit was a dead button — indistinguishable from a broken one.
   * The AI path already reports its rejections in chat; this is the same honesty for the UI.
   */
  commandError: string | null;

  addAsset: (a: Asset) => void;
  updateAsset: (id: string, patch: Partial<Asset>) => void;
  setPrimary: (id: string | null) => void;

  /** Replace the EDL wholesale and RESET the undo history to it (project hydrate / external set). */
  setEdl: (edl: Edl, opts?: { persist?: boolean }) => void;
  /**
   * Apply a server-computed AI-turn EDL as a NEW, undoable history entry (does not reset history,
   * does not re-persist — the /api/plan route already saved it). This is what makes "undo the AI
   * edit" work. Falls back to seeding if there's no EDL/history yet.
   */
  applyAiEdl: (edl: Edl) => void;
  /** The ONE mutation path. Returns true if the batch applied (false if rejected/no EDL). */
  dispatch: (commands: EditCommand[], opts?: { persist?: boolean; rationale?: string; coalesceKey?: string }) => boolean;
  /** Close any in-progress drag-coalescing run so the next gesture is a fresh undo step. */
  endGesture: () => void;
  undo: () => void;
  redo: () => void;

  seekTo: (ms: number) => void;
  togglePlay: () => void;
  selectClip: (id: string | null) => void;

  // Transport-level convenience used by hotkeys + the Timeline; each builds a command.
  splitAtPlayhead: () => void;
  rippleDelete: () => void;
  nudgeTrim: (side: "in" | "out", deltaMs: number, opts?: { coalesceKey?: string }) => void;
  moveClip: (id: string, newTimelineStartMs: number, opts?: { coalesceKey?: string }) => void;
}

/** Undo/redo history lives outside zustand state (a mutable controller) to avoid render churn. */
let history: EditHistory | null = null;

/** Two retries (three attempts total) over ~1.8s — long enough to ride out a blip, short enough
 *  that a real outage reaches `saveState: 'error'` while the user is still looking at the editor. */
const AUTOSAVE_RETRIES = 2;
const AUTOSAVE_RETRY_MS = 600;
/** Browsers cap the TOTAL body of keepalive requests at 64KB and reject anything over it outright. */
const KEEPALIVE_MAX_BYTES = 60_000;

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * What the user is shown when the reducer refuses a batch. A `CommandError`'s message is already
 * written for a human; anything else (the Edl.parse tripwire, an unexpected bug) is reported as a
 * refusal too rather than being swallowed — an edit that didn't apply must never look like it did.
 */
const rejectionMessage = (err: unknown): string =>
  err instanceof CommandError ? err.message : `couldn't apply that edit — ${errorMessage(err)}`;

/**
 * A save result belongs to the project whose payload produced it, not to whatever the store holds by
 * the time it lands. Switching projects FLUSHES the outgoing project's queued edit (hydrateProject),
 * and a retry can settle well after the navigation — so writing status unconditionally showed
 * project A's failure as project B's, which the AI turn gate (ChatWindow) then refuses to plan
 * through on a project the user never edited. Same staleness guard `loadAssets`/`hydrateEdl` use.
 */
const isCurrentProject = (payload: { projectId: string }): boolean =>
  useEditor.getState().projectId === payload.projectId;

const persister = createDebouncedPersister<{ projectId: string; edl: Edl; rationale: string }>({
  send: async (payload, { keepalive }) => {
    const body = JSON.stringify(payload);
    const res = await fetch("/api/edits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // An unload flush must not be cancelled with the document — that is the whole point of the
      // beforeunload handler. Oversized bodies fall back to a normal fetch (which the unload may
      // kill) rather than a keepalive request the browser refuses to send at all.
      keepalive: keepalive && new TextEncoder().encode(body).byteLength <= KEEPALIVE_MAX_BYTES,
    });
    if (!res.ok) throw new Error(`persist edit: ${res.status}`);
  },
  waitMs: 500,
  retries: AUTOSAVE_RETRIES,
  retryDelayMs: AUTOSAVE_RETRY_MS,
  // Honest, renderable state instead of a console.warn nobody reads. 'saving'/'saved' clear the
  // previous failure; the message for 'error' arrives right after, via onError. Both drop results
  // for a project the store has already left (see isCurrentProject).
  onStatusChange: (saveState, payload) => {
    if (!isCurrentProject(payload)) return;
    useEditor.setState(saveState === "error" ? { saveState } : { saveState, saveError: null });
  },
  onError: (err, payload) => {
    if (!isCurrentProject(payload)) return;
    useEditor.setState({ saveError: errorMessage(err) });
  },
});

function schedulePersist(edl: Edl, rationale: string) {
  const { projectId, edlLoadError } = useEditor.getState();
  if (!projectId) return;
  if (edlLoadError) {
    // The saved edit couldn't be loaded, so this EDL is not a descendant of the user's real cut.
    // Refuse to append it as the new latest version, and say why rather than looking saved.
    useEditor.setState({ saveState: "error", saveError: `not saving — ${edlLoadError}` });
    return;
  }
  persister.persist({ projectId, edl, rationale });
}

/**
 * Real media length per assetId, in ticks — the external fact `reduceBatch` can't look up. Without
 * it every clip a batch mints is bounded by its own out point, so "extend that clip" afterwards is a
 * silent no-op (see ReduceOptions.assetDurationsTicks). Assets whose duration isn't probed yet are
 * omitted, which keeps the reducer's conservative fallback.
 */
function assetDurationsTicks(assets: Asset[]): Record<string, number> {
  const durations: Record<string, number> = {};
  for (const a of assets) {
    const ms = a.duration_ms ?? 0;
    if (ms > 0) durations[a.id] = msToTicks(ms);
  }
  return durations;
}

/** Seed/replace the EDL and reset the history controller to it. */
function seed(edl: Edl) {
  history = new EditHistory(edl);
  // A refusal describes the timeline that WAS on screen; replacing that timeline retires it.
  useEditor.setState({ edl, canUndo: false, canRedo: false, commandError: null });
}

export const useEditor = create<EditorStore>((set, get) => ({
  projectId: null,
  assets: [],
  primaryAsset: null,
  edl: null,
  currentTimeMs: 0,
  isPlaying: false,
  selectedClipId: null,
  canUndo: false,
  canRedo: false,
  saveState: "saved",
  saveError: null,
  edlLoadError: null,
  commandError: null,

  addAsset: (a) => {
    set((s) => ({ assets: [...s.assets, a], primaryAsset: s.primaryAsset ?? a }));
    if (!get().edl && a.kind === "video" && (a.duration_ms ?? 0) > 0) {
      seed(emptyEdl2(a.id, msToTicks(a.duration_ms!), a.blob_url));
    }
  },

  updateAsset: (id, patch) => {
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      primaryAsset: s.primaryAsset?.id === id ? { ...s.primaryAsset, ...patch } : s.primaryAsset,
    }));
    const a = get().assets.find((x) => x.id === id);
    if (!get().edl && a?.kind === "video" && (a.duration_ms ?? 0) > 0) {
      seed(emptyEdl2(a.id, msToTicks(a.duration_ms!), a.blob_url));
    }
  },

  setPrimary: (id) => {
    const a = get().assets.find((x) => x.id === id) ?? null;
    set({ primaryAsset: a });
    if (a && !get().edl && a.kind === "video" && (a.duration_ms ?? 0) > 0) {
      seed(emptyEdl2(a.id, msToTicks(a.duration_ms!), a.blob_url));
    }
  },

  setEdl: (edl, opts) => {
    seed(edl);
    if (opts?.persist) schedulePersist(edl, "external set");
  },

  applyAiEdl: (edl) => {
    const cur = get().edl;
    // No baseline yet (e.g. AI produced the first edit on a fresh project): seed it.
    if (!cur || !history) {
      seed(edl);
      return;
    }
    history.pushSnapshot(edl, { summary: "ai edit" });
    set({ edl, canUndo: history.canUndo(), canRedo: history.canRedo(), commandError: null });
    // NOTE: deliberately no schedulePersist — /api/plan already persisted this version.
  },

  dispatch: (commands, opts) => {
    const cur = get().edl;
    if (!cur) return false;
    if (!history) history = new EditHistory(cur);
    try {
      const edl = history.apply(commands, {
        coalesceKey: opts?.coalesceKey,
        reduceOptions: { assetDurationsTicks: assetDurationsTicks(get().assets) },
      });
      set({ edl, canUndo: history.canUndo(), canRedo: history.canRedo(), commandError: null });
      // Persist is debounced (500ms), so streaming a drag through here coalesces to one write of the
      // final state — no need to special-case the gesture.
      if (opts?.persist ?? true) schedulePersist(edl, opts?.rationale ?? commands.map((c) => c.type).join("+"));
      return true;
    } catch (e) {
      // Say it, don't just log it: a CommandError already carries a sentence written for a human
      // ("clip c0 already ends at its media's last tick"), and the chrome renders it (EditorAlerts,
      // which reads `commandError`; the StatusBar that used to carry it is gone).
      // The console line stays for the dev trail.
      console.warn("[editor] command rejected:", (e as Error).message);
      set({ commandError: rejectionMessage(e) });
      return false;
    }
  },

  endGesture: () => {
    history?.endCoalescing();
  },

  // undo/redo clear `commandError` for the same reason a successful dispatch does: the timeline just
  // moved, so the last refusal is no longer what the screen is showing.
  undo: () => {
    if (!history || !history.canUndo()) return;
    const edl = history.undo();
    set({ edl, canUndo: history.canUndo(), canRedo: history.canRedo(), commandError: null });
    schedulePersist(edl, "undo");
  },
  redo: () => {
    if (!history || !history.canRedo()) return;
    const edl = history.redo();
    set({ edl, canUndo: history.canUndo(), canRedo: history.canRedo(), commandError: null });
    schedulePersist(edl, "redo");
  },

  seekTo: (ms) => set({ currentTimeMs: ms }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  selectClip: (id) => set({ selectedClipId: id }),

  splitAtPlayhead: () => {
    const { edl, currentTimeMs, selectedClipId } = get();
    if (!edl) return;
    const tick = msToTicks(currentTimeMs);
    // Prefer the SELECTED clip when the playhead sits inside it: the Split control is only offered
    // while a clip is selected, so "split" means "split this clip". clipAtTick() returns the first
    // clip across ALL tracks at that tick, which on a multi-video-track timeline would split the
    // wrong lane. Fall back to whatever clip is under the playhead when nothing apt is selected.
    const sel = selectedClipId ? locateClip(edl, selectedClipId) : null;
    const pos = sel && tick > sel.startTick && tick < sel.endTick ? sel : clipAtTick(edl, tick);
    if (!pos) return;
    get().dispatch([{ type: "SPLIT_CLIP", clipId: pos.clip.id, atTick: tick }], { rationale: "split at playhead" });
  },

  rippleDelete: () => {
    const { selectedClipId } = get();
    if (!selectedClipId) return;
    if (get().dispatch([{ type: "REMOVE_CLIP", clipId: selectedClipId, ripple: true }], { rationale: "ripple delete" })) {
      set({ selectedClipId: null });
    }
  },

  nudgeTrim: (side, deltaMs, opts) => {
    const { edl, selectedClipId } = get();
    if (!edl || !selectedClipId) return;
    const pos = locateClip(edl, selectedClipId);
    if (!pos) return;
    const edgeTick = side === "in" ? pos.startTick : pos.endTick;
    get().dispatch([{ type: "TRIM_CLIP", clipId: selectedClipId, edge: side, toTick: edgeTick + msToTicks(deltaMs) }], { rationale: `trim ${side}`, coalesceKey: opts?.coalesceKey });
  },

  moveClip: (id, newTimelineStartMs, opts) => {
    const { edl } = get();
    if (!edl) return;
    const pos = locateClip(edl, id);
    if (!pos) return;
    // v1 single-video-track invariant: `toTrackId` is pinned to the clip's CURRENT track, so a
    // drag can only reposition along the timeline — never spawn a second video track. The renderer
    // (HiteRoot) stacks video tracks as full-bleed layers with no per-track transform, so a second
    // video track would just occlude the one beneath it (no PiP/split-screen yet). Keeping moves
    // on-track preserves preview==export. Stacking on TOP of the video is done via overlays.
    get().dispatch([{ type: "MOVE_CLIP", clipId: id, toTrackId: pos.track.id, atTick: Math.max(0, msToTicks(newTimelineStartMs)) }], { rationale: "move clip", coalesceKey: opts?.coalesceKey });
  },
}));

/** Bulk-load assets from server payload into the editor store. Seeds an empty Edl.2 from the
 *  primary video if no EDL has been hydrated yet (fresh project with footage but no saved edit).
 *  A payload for a project the store no longer holds is dropped — see `hydrateProject`. */
export function loadAssets(projectId: string, assets: Asset[]) {
  if (useEditor.getState().projectId !== projectId) return;
  const primary = assets.find((a) => a.kind === "video") ?? assets[0] ?? null;
  useEditor.setState({ assets, primaryAsset: primary });
  if (!useEditor.getState().edl && primary && primary.kind === "video" && (primary.duration_ms ?? 0) > 0) {
    seed(emptyEdl2(primary.id, msToTicks(primary.duration_ms!), primary.blob_url));
  }
}

/** Hydrate the editor with a saved Edl.2 (latest edit on project load). Becomes the undo baseline.
 *  Dropped if the store has since moved to another project — see `hydrateProject`. */
export function hydrateEdl(projectId: string, edl: Edl) {
  if (useEditor.getState().projectId !== projectId) return;
  seed(edl);
}

export interface ProjectHydration {
  projectId: string;
  assets: Asset[];
  /** The project's latest saved Edl.2, or null when it has none (or none that loaded). */
  edl: Edl | null;
  /** Why the saved edit couldn't be parsed/migrated, if that's why `edl` is null. */
  edlLoadError?: string | null;
}

/**
 * THE project-load entry point. Every editor mount/navigation goes through here.
 *
 * The store is a module singleton and client-side navigation between projects does NOT tear it
 * down, so hydrating without a reset left the previous project's EDL, undo history and pending
 * autosave live on the new one: project B rendered A's timeline and B's first edit persisted A's
 * cut as B's version 1. The reset is keyed on projectId — re-hydrating the SAME project (a prop
 * identity change, a router refresh) deliberately keeps the live edits it already holds.
 */
export function hydrateProject({ projectId, assets, edl, edlLoadError = null }: ProjectHydration): void {
  const current = useEditor.getState().projectId;
  if (current !== projectId) {
    // Flush, never cancel: the queued payload carries its OWN projectId, so the outgoing project's
    // last edit still lands on the outgoing project — and its save status is dropped once the store
    // has moved on (isCurrentProject), so A's failure can never block B's AI turn.
    if (current !== null) void persister.flush();
    resetForProject(projectId);
  }
  // The server load is authoritative about whether this project's saved edit is readable, so this
  // both raises and clears the flag that blocks autosave.
  useEditor.setState({ edlLoadError });
  if (edl) hydrateEdl(projectId, edl);
  loadAssets(projectId, assets);
}

/** Wipe every per-project field (incl. the out-of-band undo history) and adopt the new project. */
function resetForProject(projectId: string): void {
  history = null;
  useEditor.setState({
    projectId,
    assets: [],
    primaryAsset: null,
    edl: null,
    currentTimeMs: 0,
    isPlaying: false,
    selectedClipId: null,
    canUndo: false,
    canRedo: false,
    saveState: "saved",
    saveError: null,
    edlLoadError: null,
    commandError: null,
  });
}

/** Force any pending autosave to flush. Pass `keepalive` from a beforeunload handler so the request
 *  outlives the document instead of being cancelled with it. */
export function flushManualEdits(opts?: { keepalive?: boolean }): Promise<void> {
  return persister.flush(opts);
}
