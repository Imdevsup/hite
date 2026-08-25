/**
 * choreography/script.ts — the ONE source of truth for everything the demo says and does.
 *
 * The chat text, the twelve tool calls, the commands each one puts into the batch, and the staged
 * demo project they operate on all live here as typed data, so the 3D visuals, the DOM fallbacks
 * (mobile / reduced-motion) and the honesty tests read the same object and can never drift.
 *
 * HONESTY CONTRACT (CLAUDE.md "Honesty rules for the landing"):
 *  - Every `tool` below is a REAL planner tool name from `lib/ai/tools/registry.ts`, and every one
 *    is exposed by the router for `DEMO_PROMPT` (`script.test.ts` pins this via `selectToolSpecs`).
 *  - Every `command` is a REAL `EditCommand` type from `lib/edl/commands.ts`.
 *  - Every registry key named in an argument is a REAL, RENDERABLE key from the bundled manifest.
 *  - The project is a STAGED demo, declared as such on the page. Every number shown is derived from
 *    `DEMO_PROJECT` by `deriveDemoStats()`; nothing is typed in as a result or a customer claim.
 *  - Thumbnails are procedural abstract posters, never footage. `hasMedia` is false.
 */

export const TICKS_PER_SECOND = 30000;

export interface DemoClip {
  /** Filename as an NLE would show it in the clip's top-left corner. */
  readonly name: string;
  /** Source duration in seconds. */
  readonly seconds: number;
  /** Source / media-type colour dot: 0 A-cam, 1 B-cam/GoPro, 2 screen, 3 drone, 4 audio. */
  readonly source: 0 | 1 | 2 | 3 | 4;
  /** Dead-air regions `[startSec, endSec]` that `findSilences` reports for this clip. */
  readonly silences: readonly (readonly [number, number])[];
}

/**
 * The staged project. 24 clips, camera-generated and human-named filenames mixed the way a real
 * project looks. Durations and silences are authored here ONCE; everything else is computed.
 */
export const DEMO_PROJECT: readonly DemoClip[] = [
  { name: "A001_C0034_2410.mp4", seconds: 318, source: 0, silences: [[0, 6.2], [41, 44.1], [122, 129.4], [240, 243]] },
  { name: "GX010217.MP4", seconds: 207, source: 1, silences: [[0, 4.1], [88, 93.5]] },
  { name: "interview_wide_02.mov", seconds: 412, source: 0, silences: [[0, 9.8], [60, 66], [150, 152.7], [301, 309], [398, 412]] },
  { name: "A001_C0037_2410.mp4", seconds: 254, source: 0, silences: [[33, 37.2], [190, 198]] },
  { name: "bts_handheld_07.mp4", seconds: 141, source: 1, silences: [[0, 3.3], [77, 80.1]] },
  { name: "dusk_rooftop_01.mp4", seconds: 96, source: 3, silences: [[0, 96]] },
  { name: "A002_C0118_2411.mp4", seconds: 366, source: 0, silences: [[12, 18.4], [201, 206], [330, 339]] },
  { name: "screen_rec_final.mov", seconds: 228, source: 2, silences: [[0, 5.5], [114, 121.2]] },
  { name: "drone_pass_03.mp4", seconds: 74, source: 3, silences: [[0, 74]] },
  { name: "A002_C0121_2411.mp4", seconds: 299, source: 0, silences: [[0, 7.7], [140, 146.3], [262, 271]] },
  { name: "GX010224.MP4", seconds: 183, source: 1, silences: [[92, 97.4]] },
  { name: "cutaway_hands_11.mov", seconds: 62, source: 1, silences: [[0, 62]] },
  { name: "street_night_04.mp4", seconds: 118, source: 1, silences: [[0, 118]] },
  { name: "A003_C0006_2412.mp4", seconds: 341, source: 0, silences: [[0, 11.2], [180, 187.6], [290, 297]] },
  { name: "room_tone_A.wav", seconds: 45, source: 4, silences: [[0, 45]] },
  { name: "A003_C0009_2412.mp4", seconds: 287, source: 0, silences: [[20, 24.4], [211, 219]] },
  { name: "GX010231.MP4", seconds: 166, source: 1, silences: [[0, 2.8], [100, 105.5]] },
  { name: "interview_tight_03.mov", seconds: 398, source: 0, silences: [[0, 8.1], [77, 83], [245, 251.4], [370, 398]] },
  { name: "A004_C0012_2413.mp4", seconds: 276, source: 0, silences: [[48, 55.3], [233, 240]] },
  { name: "bts_handheld_09.mp4", seconds: 104, source: 1, silences: [[0, 4.6], [51, 56.2]] },
  { name: "drone_pass_04.mp4", seconds: 58, source: 3, silences: [[0, 58]] },
  { name: "A004_C0015_2413.mp4", seconds: 322, source: 0, silences: [[0, 6.9], [160, 167.1], [306, 322]] },
  { name: "screen_rec_cutaway.mov", seconds: 91, source: 2, silences: [[40, 46.6]] },
  { name: "GX010236.MP4", seconds: 188, source: 1, silences: [[0, 3.9], [130, 136.8]] },
];

/** Frame where the intro ends: `suggestPacing` retimes everything before it. */
export const INTRO_END_SECONDS = 18 * 60;
export const RETIME_FACTOR = 1.35;
/** Tempo `analyzeBeats` reports for the music bed. */
export const SCORE_BPM = 92;
/** Registry keys every chip argument is allowed to name. All renderable, all in the manifest. */
export const DEMO_KEYS = {
  transition: "trans-fade",
  lut: "lut-a24-moonlight",
  overlay: "overlay-light-leak",
  caption: "text-lower-third-basic",
} as const;

export interface DemoStats {
  readonly clipCount: number;
  readonly sourceSeconds: number;
  readonly silenceCount: number;
  readonly silenceSeconds: number;
  /** After the ripple delete, before the retime. */
  readonly afterSilenceSeconds: number;
  /** After the retime of the intro. */
  readonly afterRetimeSeconds: number;
  readonly transitionCount: number;
  readonly brollCount: number;
  readonly captionCount: number;
  readonly beatMarkerCount: number;
  readonly commandCount: number;
}

/** Every number on the page comes out of this function. No literals downstream. */
export function deriveDemoStats(project: readonly DemoClip[] = DEMO_PROJECT): DemoStats {
  const sourceSeconds = project.reduce((s, c) => s + c.seconds, 0);
  const silences = project.flatMap((c) => c.silences.map(([a, b]) => b - a));
  const silenceSeconds = silences.reduce((s, d) => s + d, 0);
  const afterSilenceSeconds = sourceSeconds - silenceSeconds;
  const introKept = Math.min(INTRO_END_SECONDS, afterSilenceSeconds);
  const afterRetimeSeconds = afterSilenceSeconds - introKept + introKept / RETIME_FACTOR;
  const transitionCount = project.filter((c) => c.source === 0).length - 1; // talking-head cuts
  const brollCount = 4;
  const captionCount = Math.round(afterRetimeSeconds / 4.2);
  // One marker every eight bars (32 beats): cut points, not every beat.
  const beatMarkerCount = Math.round((afterRetimeSeconds / 60) * (SCORE_BPM / 32));
  const commandCount =
    silences.length + 1 + transitionCount + brollCount + 1 + captionCount + 1 + beatMarkerCount;
  return {
    clipCount: project.length,
    sourceSeconds,
    silenceCount: silences.length,
    silenceSeconds,
    afterSilenceSeconds,
    afterRetimeSeconds,
    transitionCount,
    brollCount,
    captionCount,
    beatMarkerCount,
    commandCount,
  };
}

/** `hh:mm:ss` for stats; `hh:mm:ss:ff` for the ruler and playhead. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatTimecode(totalSeconds: number, fps = 30): string {
  const whole = Math.floor(totalSeconds);
  const frames = Math.floor((totalSeconds - whole) * fps);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return [h, m, s, frames].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Spoken, not typed: "1h 32m 14s". */
export function formatSpoken(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h > 0 ? `${h}h` : null, `${m}m`, `${String(sec).padStart(2, "0")}s`].filter(Boolean).join(" ");
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   THE CONVERSATION
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The one sentence. Written so the router exposes every tier the twelve calls need — speech,
 * structure, planning, motion, color, text and rhythm (`script.test.ts` asserts it).
 */
export const DEMO_PROMPT =
  "cut the dead air, tighten the intro, fade between the talking heads, grade it moody, caption the whole thing and cut the rest to the beat";

export type ChipCategory = "analysis" | "edit" | "advisor" | "registry" | "terminal";

export interface ToolCall {
  readonly id: string;
  /** Real tool name, or a real EditCommand type when `kind` is "command". */
  readonly name: string;
  readonly kind: "tool" | "command";
  readonly category: ChipCategory;
  /** What the chip prints, as a call signature. */
  readonly signature: string;
  /** The EditCommand types this call contributes to the final batch. */
  readonly commands: readonly string[];
  /** Spec §7 — what the timeline does. Drives the visual handler keyed by `effect`. */
  readonly effect:
    | "analyze"
    | "silences"
    | "ripple"
    | "retime"
    | "transitions"
    | "search"
    | "insert"
    | "grade"
    | "captions"
    | "score"
    | "beatsync"
    | "export";
  /** Terse AI line in the thread after this call resolves, if any. */
  readonly commentary?: string;
}

const stats = deriveDemoStats();

export const TOOL_CALLS: readonly ToolCall[] = [
  {
    id: "analyze",
    name: "analyzeTranscript",
    kind: "tool",
    category: "analysis",
    signature: `analyzeTranscript(assetIds: ${stats.clipCount})`,
    commands: [],
    effect: "analyze",
  },
  {
    id: "silences",
    name: "findSilences",
    kind: "tool",
    category: "analysis",
    signature: "findSilences(minMs: 600)",
    commands: [],
    effect: "silences",
  },
  {
    id: "ripple",
    name: "TRIM_CLIP",
    kind: "command",
    category: "edit",
    signature: `TRIM_CLIP × ${stats.silenceCount}`,
    commands: ["TRIM_CLIP", "SPLIT_CLIP"],
    effect: "ripple",
    commentary: `Cut ${stats.silenceCount} dead spots. Down to ${formatSpoken(stats.afterSilenceSeconds)}.`,
  },
  {
    id: "retime",
    name: "suggestPacing",
    kind: "tool",
    category: "advisor",
    signature: `suggestPacing(range: "00:00-${formatClock(INTRO_END_SECONDS)}")`,
    commands: ["SET_CLIP_SPEED"],
    effect: "retime",
  },
  {
    id: "transitions",
    name: "suggestTransition",
    kind: "tool",
    category: "advisor",
    signature: `suggestTransition(key: "${DEMO_KEYS.transition}", n: ${stats.transitionCount})`,
    commands: ["ADD_TRANSITION"],
    effect: "transitions",
    commentary: "Fades on the talking-head cuts, hard cuts everywhere else.",
  },
  {
    id: "search",
    name: "searchRegistry",
    kind: "tool",
    category: "registry",
    signature: 'searchRegistry(q: "moody overlay", n: 6)',
    commands: [],
    effect: "search",
  },
  {
    id: "insert",
    name: "ADD_OVERLAY",
    kind: "command",
    category: "edit",
    signature: `ADD_OVERLAY(key: "${DEMO_KEYS.overlay}", track: V2) × ${stats.brollCount}`,
    commands: ["ADD_OVERLAY"],
    effect: "insert",
    commentary: `Laid ${stats.brollCount} overlay beats under the middle section.`,
  },
  {
    id: "grade",
    name: "suggestColorGrade",
    kind: "tool",
    category: "advisor",
    signature: `suggestColorGrade(lut: "${DEMO_KEYS.lut}", mix: 0.7)`,
    commands: ["ADD_EFFECT"],
    effect: "grade",
  },
  {
    id: "captions",
    name: "suggestCaptionStyle",
    kind: "tool",
    category: "advisor",
    signature: `suggestCaptionStyle(key: "${DEMO_KEYS.caption}")`,
    commands: ["SET_CAPTION_STYLE", "ADD_CAPTION"],
    effect: "captions",
  },
  {
    id: "score",
    name: "analyzeBeats",
    kind: "tool",
    category: "analysis",
    signature: 'analyzeBeats(assetId: "room_tone_A.wav")',
    commands: ["ADD_AUDIO_BED"],
    effect: "score",
    commentary: `Bed in. ${SCORE_BPM}bpm, sparse.`,
  },
  {
    id: "beatsync",
    name: "planBeatCuts",
    kind: "tool",
    category: "advisor",
    signature: `planBeatCuts(bpm: ${SCORE_BPM}, markers: ${stats.beatMarkerCount})`,
    commands: ["ADD_MARKER", "PROPOSE_CUTS"],
    effect: "beatsync",
  },
  {
    id: "export",
    name: "emitEditBatch",
    kind: "tool",
    category: "terminal",
    signature: `emitEditBatch(commands: ${stats.commandCount})`,
    commands: ["SET_OUTPUT_VARIANT"],
    effect: "export",
  },
];

export const THREAD = {
  user: DEMO_PROMPT,
  firstLine: `On it. ${stats.clipCount} clips, ${formatSpoken(stats.sourceSeconds)}. Starting with the silence.`,
  closing: `Done. ${formatClock(stats.afterRetimeSeconds)}, faded, graded, captioned, on the beat. Want it tighter?`,
  /** The stat that lands in Act 4's resolve. */
  stat: `${formatClock(stats.sourceSeconds)} → ${formatClock(stats.afterRetimeSeconds)}`,
  /** What the export chip's progress readout says. Real preset: 1920×1080 H.264. */
  exportLabel: "Rendering 1080p H.264",
} as const;

/* ────────────────────────────────────────────────────────────────────────────────────────────
   SUBTITLES (spec §8)
   ──────────────────────────────────────────────────────────────────────────────────────────── */

export interface Subtitle {
  readonly p: number;
  readonly text: string;
}

export const SUBTITLES: readonly Subtitle[] = [
  { p: 0.03, text: "Every edit you'll ever make is a moment in time." },
  { p: 0.12, text: "A cut. A beat. A breath you took out." },
  { p: 0.26, text: "Hite lays all of it flat." },
  { p: 0.36, text: "Then you just tell it what you want." },
  { p: 0.52, text: "It doesn't suggest. It edits." },
  { p: 0.7, text: "Fade. Grade. Caption. Beat." },
  { p: 0.87, text: `${formatSpoken(stats.sourceSeconds)}. One sentence.` },
];

/* ────────────────────────────────────────────────────────────────────────────────────────────
   ACT BOUNDARIES (spec §6) — p on the master timeline
   ──────────────────────────────────────────────────────────────────────────────────────────── */

export const ACTS = [
  { id: "act1", name: "The hero curl", from: 0, to: 0.22 },
  { id: "act2", name: "The descent", from: 0.22, to: 0.33 },
  { id: "act3", name: "The depth reveal", from: 0.33, to: 0.42 },
  { id: "act4", name: "The conversation", from: 0.42, to: 0.89 },
  { id: "act5", name: "The pull back", from: 0.89, to: 1 },
] as const;

export type ActId = (typeof ACTS)[number]["id"];

export function actAt(p: number): (typeof ACTS)[number] {
  return ACTS.find((a) => p >= a.from && p < a.to) ?? ACTS[ACTS.length - 1];
}

/** Tool calls run p 0.49 → 0.85; each gets an equal share and overlaps its neighbour by 35%. */
export const TOOL_WINDOW = { from: 0.49, to: 0.85 } as const;

export function toolCallWindow(index: number): { start: number; end: number } {
  // Calls overlap by 15% (spec minimum) rather than 35%: one thing at a time reads clean.
  const slot = (TOOL_WINDOW.to - TOOL_WINDOW.from) / TOOL_CALLS.length;
  const start = TOOL_WINDOW.from + slot * index;
  return { start, end: Math.min(TOOL_WINDOW.to, start + slot * 1.15) };
}
