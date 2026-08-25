import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry";
import { msToTicks } from "@/lib/edl/time";
import { assertAssetAllowed } from "../_guard";
import { readTranscript, TICKS_UNITS_NOTE, type StoredTranscriptWord } from "../db";

/**
 * findFillerWords — surface filler words with TICK-accurate windows so the planner can cut them.
 *
 * WHY THIS IS FUSSY: "like", "so", "actually", "literally" and "basically" were classified as
 * fillers unconditionally, so "I **like** this camera **so** much" came back as two cuts and the
 * export butchered the sentence. Those five are ordinary English words most of the time. They are
 * only reported here when a DISFLUENCY SIGNAL backs them up — a pause on either side, or an
 * immediate repetition — and every hit says which rule fired so the planner (and the user) can see
 * why. Non-lexical fillers (um, uh, er…) and the two fixed phrases need no signal: they are never
 * load-bearing.
 *
 * Reads the stored word-level transcript (`transcript.segments[].words`) and converts ms → ticks at
 * this boundary. Word timings across segments are flattened first, so a pause or a phrase that
 * straddles a segment boundary is still seen.
 */

/** Silence on either side of a word that marks it as a disfluency rather than speech. */
const PAUSE_MS = 300;

/** Never load-bearing: cutting one of these cannot change what a sentence means. */
const NON_LEXICAL = new Set(["um", "umm", "uh", "uhh", "er", "erm", "hmm", "mhm", "ah", "eh"]);

/** Fixed filler phrases that are safe to cut wherever they appear. */
const NON_LEXICAL_PHRASES = [
  ["you", "know"],
  ["i", "mean"],
];

/** Real words that are ALSO used as fillers — reported only with a supporting signal. */
const DISCOURSE = new Set(["like", "so", "actually", "literally", "basically"]);
const DISCOURSE_PHRASES = [
  ["sort", "of"],
  ["kind", "of"],
];

interface Filler {
  startTick: number;
  endTick: number;
  word: string;
  /** Which rule fired — the model must be able to explain (and the user to audit) every cut. */
  rule: string;
  /** True only for words that are never load-bearing. `false` = a judgement call, mention it. */
  confident: boolean;
}

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z']/g, "")
    .trim();
}

/** Silence before word `i` (measured from the clip start for the first word). */
function gapBeforeMs(words: StoredTranscriptWord[], i: number): number {
  return i === 0 ? words[0].t0Ms : words[i].t0Ms - words[i - 1].t1Ms;
}

/** Silence after word `i`, or null when it is the last word (nothing to measure against). */
function gapAfterMs(words: StoredTranscriptWord[], i: number): number | null {
  return i === words.length - 1 ? null : words[i + 1].t0Ms - words[i].t1Ms;
}

/** The disfluency signal backing a discourse word, or null when it is just being a word. */
function disfluencySignal(words: StoredTranscriptWord[], norms: string[], start: number, end: number): string | null {
  if (start > 0 && norms[start - 1] === norms[start]) return "immediately repeated (stutter)";
  const before = gapBeforeMs(words, start);
  if (before >= PAUSE_MS) return `preceded by a ${Math.round(before)}ms pause`;
  const after = gapAfterMs(words, end);
  if (after !== null && after >= PAUSE_MS) return `followed by a ${Math.round(after)}ms pause`;
  return null;
}

/** Does the token run at `i` match this phrase exactly? */
function phraseAt(norms: string[], i: number, phrase: string[]): boolean {
  if (i + phrase.length > norms.length) return false;
  return phrase.every((p, j) => norms[i + j] === p);
}

export const spec: ToolSpec = {
  name: "findFillerWords",
  tier: "speech",
  whenToUse: "Find filler words (um, uh, you know) with timestamps to cut, plus flagged 'like/so' candidates.",
  tool: tool({
    description:
      "Scan the stored word-level transcript for filler words and return their windows in editor TICKS (30000/sec). Each hit carries the `rule` that flagged it and `confident`: true = a non-lexical filler (um, uh, you know) that is always safe to cut; false = a real word (like, so, actually) that looked like a filler because of an adjacent pause or repetition — cut those only if the user asked broadly, and mention them. Empty list plus a `note` means there is no word-level transcript, NOT that the speaker used no fillers.",
    inputSchema: z.object({
      assetId: z.string().describe("The asset whose transcript to scan for filler words."),
    }),
    execute: async ({ assetId }, { experimental_context }) => {
      assertAssetAllowed(assetId, experimental_context);
      const transcript = await readTranscript(assetId);
      const segments = transcript?.segments ?? [];
      if (segments.length === 0) {
        return {
          fillers: [] as Filler[],
          note: "No transcript exists for this clip, so filler words cannot be located. Do not claim there are none.",
          units: TICKS_UNITS_NOTE,
        };
      }

      const words = segments
        .flatMap((s) => s.words)
        .filter((w) => Number.isFinite(w.t0Ms) && Number.isFinite(w.t1Ms) && w.t1Ms > w.t0Ms)
        .sort((a, b) => a.t0Ms - b.t0Ms);
      if (words.length === 0) {
        return {
          fillers: [] as Filler[],
          note: "This transcript has segments but no word-level timings, so individual words cannot be cut accurately. Do not claim there are no fillers — say word timings are unavailable.",
          units: TICKS_UNITS_NOTE,
        };
      }

      const norms = words.map((w) => normalize(w.word));
      const fillers: Filler[] = [];
      const push = (start: number, end: number, label: string, rule: string, confident: boolean) => {
        fillers.push({
          startTick: msToTicks(words[start].t0Ms),
          endTick: msToTicks(words[end].t1Ms),
          word: label,
          rule,
          confident,
        });
      };

      for (let i = 0; i < words.length; i++) {
        if (!norms[i]) continue;

        const nonLexicalPhrase = NON_LEXICAL_PHRASES.find((p) => phraseAt(norms, i, p));
        if (nonLexicalPhrase) {
          const end = i + nonLexicalPhrase.length - 1;
          push(i, end, nonLexicalPhrase.join(" "), "fixed filler phrase", true);
          i = end;
          continue;
        }

        if (NON_LEXICAL.has(norms[i])) {
          push(i, i, norms[i], "non-lexical filler", true);
          continue;
        }

        const discoursePhrase = DISCOURSE_PHRASES.find((p) => phraseAt(norms, i, p));
        if (discoursePhrase) {
          const end = i + discoursePhrase.length - 1;
          const signal = disfluencySignal(words, norms, i, end);
          if (signal) {
            push(i, end, discoursePhrase.join(" "), `hedge phrase, ${signal}`, false);
            i = end;
          }
          continue;
        }

        if (DISCOURSE.has(norms[i])) {
          const signal = disfluencySignal(words, norms, i, i);
          if (signal) push(i, i, norms[i], `discourse word, ${signal}`, false);
        }
      }

      fillers.sort((a, b) => a.startTick - b.startTick);
      return {
        fillers,
        confidentCount: fillers.filter((f) => f.confident).length,
        units: TICKS_UNITS_NOTE,
      };
    },
  }),
};
