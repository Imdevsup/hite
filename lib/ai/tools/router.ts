import type { Tool } from "ai";
import { TOOL_REGISTRY, type ToolSpec, type ToolTier } from "./registry";

/**
 * Tool router — "which tool when".
 *
 * Picks the relevant subset of the registry for a given request so the model is never shown 30+
 * tools at once (LLM tool-selection accuracy collapses past ~15-20). Below ROUTING_THRESHOLD tools
 * it's a no-op (the model sees them all); past it, the router keeps the always-on tiers plus EVERY
 * tier the prompt hits. The model then does the fine-grained pick, guided by each tool's whenToUse
 * line (see toolGuide).
 *
 * Two rules this file exists to hold, both learned from prompts that silently half-failed:
 *
 *  1. MATCH ON STEMS, NOT LITERALS. The keywords used to be singular-literal, so "add captions" —
 *     the product's own empty-state example — matched nothing at all, and "sync the cuts to the
 *     music and add subtitles" got beat tools with no transcript tool, leaving the model to invent
 *     caption text or drop half the request.
 *  2. A NO-MATCH PROMPT GETS A CURATED SUBSET, NOT EVERYTHING — BUT THE SUBSET MUST BE ABLE TO CUT.
 *     Widening to the whole registry put the vaguest prompts ("make it pop") into exactly the
 *     >16-tool degradation this router exists to prevent. Narrowing the fallback to the aesthetic
 *     advisors then broke the opposite way: "trim the fat" / "get rid of the awkward gaps" matched
 *     nothing, so a trim request was answered with four tools that recolour and add transitions and
 *     not one that can find a silence or plan a cut-down. The fallback now spans BOTH readings of a
 *     vague ask — cut it down (structure/planning/speech) and make it look better (color/motion) —
 *     and still lands under the cliff.
 */

const ALWAYS_ON: readonly ToolTier[] = ["registry"];
const ROUTING_THRESHOLD = 16;

/**
 * What a prompt that matches no tier at all gets ("make it pop", "clean it up"). A no-match prompt
 * is by definition one we could not classify, so the fallback covers the two things such a request
 * ever turns out to mean — trim it (structure/planning/speech) or restyle it (color/motion) — rather
 * than betting on one. Tiers, not names, so a new advisor joins the fallback automatically.
 *
 * Sized deliberately: these five tiers plus `registry` are 15 tools, which with the planner's own
 * `emitEditBatch` is exactly ROUTING_THRESHOLD. Adding a sixth tier here would push the vaguest
 * prompts back over the accuracy cliff — widen the KEYWORDS instead.
 */
const DEFAULT_TIERS: readonly ToolTier[] = ["structure", "planning", "speech", "color", "motion"];

/**
 * Per-tier trigger words, written as STEMS. A word of 4+ characters also matches up to three extra
 * letters ("caption" → captions/captioning, "drop" → drops/dropped); shorter ones match themselves
 * and a plural only ("cut" → cuts), so "vo" cannot match "vote". Multi-word entries match across any
 * whitespace. Over-matching costs a few extra tools; under-matching silently withholds a capability
 * the request needed, so this list leans inclusive.
 *
 * WRITE THE STEM WITHOUT ITS TRAILING "e" ("rambl", "dissolv", "remov"). The three extra letters are
 * appended to the WHOLE stem, so "ramble" can match rambles/rambled but never "rambling" — which is
 * how "take out the rambling" reached no tier at all. Same reason `saturat`/`grad`/`summar` are
 * already truncated.
 */
const TIER_KEYWORDS: Partial<Record<ToolTier, readonly string[]>> = {
  speech: [
    "um", "uh", "filler", "dead air", "dead space", "silence", "silent", "pause", "gap", "caption",
    "subtitle", "transcript", "said", "say", "speak", "spoken", "speech", "talk", "word", "line",
    "quote", "voiceover", "narration", "mumbl", "stutter", "rambl", "vo",
  ],
  rhythm: [
    "beat", "bpm", "tempo", "drop", "sync", "rhythm", "phonk", "music", "track", "downbeat",
    "bar", "groov", "hit",
  ],
  structure: [
    "scene", "shot", "cut", "cutting", "sequence", "restructure", "reorder", "tighten", "montage",
    "highlight", "chapter", "boundary", "clip", "trim", "remov", "delet", "get rid", "take out",
    "boring",
  ],
  vision: [
    "face", "person", "people", "subject", "reframe", "crop", "visual", "object", "on screen",
    "onscreen", "frame", "who", "overlay", "sticker", "skull", "logo", "watermark", "emoji",
  ],
  color: [
    "color", "colour", "grad", "warm", "cold", "cool", "saturat", "contrast", "vignette", "lut",
    "cinematic", "moody", "vintage", "a24", "teal", "orange", "look", "vibe", "aesthetic", "film",
    "filter", "tone", "mood", "bright", "dark",
  ],
  audio: [
    "audio", "sound", "music", "bed", "volume", "loud", "quiet", "duck", "mix", "bass", "mute",
    "vocal", "eq", "compress", "reverb", "level",
  ],
  text: [
    "caption", "subtitle", "text", "title", "lower third", "sticker", "headline", "label",
    "karaoke", "word",
  ],
  motion: [
    "zoom", "shake", "speed", "slow", "fast", "ramp", "glitch", "pan", "whip", "motion", "warp",
    "stutter", "punch", "transition", "wipe", "fade", "fading", "dissolv", "spin", "shatter",
    "distort", "rgb", "chromatic", "blur",
  ],
  planning: [
    "cut down", "tighten", "highlight", "best", "summar", "reframe", "repurpose", "plan",
    "trailer", "teaser", "recap", "short", "tiktok", "reel", "vertical", "pace", "pacing",
    "condens", "edit down", "trim", "boring",
  ],
};

/** Stems → one case-insensitive regex per tier (see TIER_KEYWORDS for the matching rules). */
function keywordPattern(stems: readonly string[]): RegExp {
  const alternatives = stems.map((stem) => {
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    // 4+ letters carry their own meaning, so allow inflections; short stems only take a plural.
    return stem.length >= 4 ? `${escaped}\\w{0,3}` : `${escaped}s?`;
  });
  return new RegExp(`\\b(?:${alternatives.join("|")})\\b`, "i");
}

const TIER_PATTERNS: Partial<Record<ToolTier, RegExp>> = Object.fromEntries(
  Object.entries(TIER_KEYWORDS).map(([tier, stems]) => [tier, keywordPattern(stems)]),
) as Partial<Record<ToolTier, RegExp>>;

/** Every tier this prompt asks for. A compound request keeps ALL of them, never the strongest one. */
export function matchedTiers(prompt: string): ToolTier[] {
  return (Object.keys(TIER_PATTERNS) as ToolTier[]).filter((tier) => TIER_PATTERNS[tier]?.test(prompt));
}

/** Resolve the ToolSpecs to expose this turn. */
export function selectToolSpecs(prompt: string): ToolSpec[] {
  if (TOOL_REGISTRY.length <= ROUTING_THRESHOLD) return TOOL_REGISTRY;

  const matched = matchedTiers(prompt);
  const wanted = new Set<ToolTier>([...ALWAYS_ON, ...(matched.length > 0 ? matched : DEFAULT_TIERS)]);
  return TOOL_REGISTRY.filter((s) => wanted.has(s.tier));
}

/** The {name → tool} map to pass to streamText for this turn. */
export function selectTools(prompt: string): Record<string, Tool> {
  return Object.fromEntries(selectToolSpecs(prompt).map((s) => [s.name, s.tool]));
}

/** A compact "when to use which tool" guide for the system prompt — the model's routing signal. */
export function toolGuide(specs: ToolSpec[]): string {
  return specs.map((s) => `- ${s.name}: ${s.whenToUse}`).join("\n");
}
