import type { Tool } from "ai";
import { analyzeTranscript } from "./analyzeTranscript";
import { analyzeBeats } from "./analyzeBeats";
import { analyzeScenes } from "./analyzeScenes";
import { detectFaces } from "./detectFaces";
import { searchRegistry } from "./searchRegistry";
import { GENERATED_TOOLS } from "./generated";

/**
 * Tool registry — the single source of truth for the planner's callable tools.
 *
 * Every tool is a ToolSpec carrying its capability `tier` and a `whenToUse`
 * line. The router (./router.ts) uses tier + the request to hand the agent the
 * RIGHT subset per turn (keeping Gemini's tool-selection sharp as the library
 * grows), and `whenToUse` is injected into the system prompt so the model knows
 * when to reach for each. New tools = add a ToolSpec here (one file per tool) —
 * no edits to the planner or reducer.
 */

export type ToolTier =
  | "registry" // exact-key resolution (always available)
  | "speech" // transcript / words / captions timing
  | "rhythm" // beats / tempo / music sync
  | "structure" // scenes / shots / sequence
  | "vision" // faces / frames / on-screen content
  | "color" // grade / look / LUT advisors
  | "audio" // sound / music bed / levels
  | "text" // captions / titles / stickers
  | "motion" // speed / zoom / glitch / transitions
  | "planning"; // higher-order recipes (cut-down, reframe, repurpose)

export interface ToolSpec {
  /** Must equal the key the model calls. */
  name: string;
  tier: ToolTier;
  /** One line the router injects into the prompt: when should the model use this? */
  whenToUse: string;
  tool: Tool;
}

export const TOOL_REGISTRY: ToolSpec[] = [
  {
    name: "searchRegistry",
    tier: "registry",
    whenToUse: "Resolve EXACT effect/look/overlay/transition/caption keys. Use before emitting any key you are not certain exists.",
    tool: searchRegistry,
  },
  {
    name: "analyzeTranscript",
    tier: "speech",
    whenToUse: "Speech-driven edits — cut filler words / dead air, find the strongest line, time captions to words.",
    tool: analyzeTranscript,
  },
  {
    name: "analyzeBeats",
    tier: "rhythm",
    whenToUse: "Music/rhythm edits — beat-synced cuts, punch-ins on the drop, tempo-aware pacing.",
    tool: analyzeBeats,
  },
  {
    name: "analyzeScenes",
    tier: "structure",
    whenToUse: "Structural edits — cut on existing shot boundaries, restructure or tighten a sequence.",
    tool: analyzeScenes,
  },
  {
    name: "detectFaces",
    tier: "vision",
    whenToUse: "Subject-aware edits — face-anchored overlays, reframing/cropping onto a person.",
    tool: detectFaces,
  },
  // NOTE: there is deliberately NO "look at the video" tool. `sampleFramesForVLM` claimed to be one
  // and sampled zero frames — it sent a blob URL as plain text to Gemini and returned the model's
  // guess as an observation of the footage. Real vision needs real frames (worker-side extraction);
  // until then the planner must ground visual questions in analysis rows or say it cannot see.
  // Workflow-built tiered library (advisors over the bundled registry + analysis-read tools).
  ...GENERATED_TOOLS,
];
