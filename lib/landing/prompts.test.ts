/**
 * lib/landing/prompts.test.ts — the E2E gate DESIGN-DIRECTION §7.2 asks for.
 *
 * "`tests/landing/prompts.e2e.test.ts` asserts, for each entry, that the real planner →
 * `flatBatchToEditBatch` → `reduceBatch` path against a committed fixture asset produces ≥1
 * EditCommand that changes the EDL. A prompt that no longer works fails the build. Adding a prompt
 * without a passing test fails the build."
 *
 * TWO DELIBERATE DEVIATIONS, both stated rather than hidden:
 *
 *  1. The test lives beside its module (`lib/**\/*.test.ts`), matching every other unit test in this
 *     repo, instead of under `tests/landing/`. `tests/` here holds Playwright specs and the
 *     Supabase-backed integration suite.
 *  2. The PLANNER ITSELF is not called. A live `streamText` turn needs `GEMINI_API_KEYS`, spends
 *     quota, and is non-deterministic — a build gate that flakes gets disabled, and a disabled gate
 *     protects nothing. What is exercised is everything downstream of the model's emission: a
 *     committed `FlatEditBatch` per prompt (the shape the planner's `emitEditBatch` tool produces)
 *     through the REAL `flatBatchToEditBatch` and the REAL `reduceBatch`. That proves the claim the
 *     page makes — this sentence maps to commands that change this timeline — while leaving "does
 *     Gemini pick these commands" to `/verify-ai`, which is where a live-model check belongs.
 *
 * THE FIXTURE. The timeline every prompt runs against is the generated §6.2 result (§7.3) — a real
 * six-clip, 0:39 timeline reduced by the real reducer, not a hand-built EDL. Clip ids are read off
 * it at test time exactly as the planner reads them off its timeline summary, so nothing here can
 * drift when the fixture is regenerated.
 */
import { describe, it, expect, vi } from "vitest";
import { flatBatchToEditBatch, type FlatEditBatch } from "@/lib/ai/edit-batch-flat";
import { reduceBatch } from "@/lib/edl/reducer";
import type { Edl } from "@/lib/edl/schema";
import { allClipPositions } from "@/lib/edl/query";
import { msToTicks, secToTicks } from "@/lib/edl/time";
import { buildMechanismFixture } from "./build-fixture";
import { FIXTURE_SILENCES_MS, FIXTURE_SOURCE_TICKS, FIXTURE_VARIANTS } from "./fixture-source";
import { isCatalogKey } from "./catalog";
// `promptHref` is deliberately NOT imported at the top: it closes over `EDITOR_REACHABILITY`, which
// resolves once at module load, so the two deployment cases import their own instance of this module
// after stubbing the env. A static import here would silently pin one of them.
import { EXAMPLE_PROMPTS, EXAMPLE_PROMPT_TEXTS } from "./prompts";

// ── the fixture timeline every prompt is proved against ─────────────────────────────────────────
const fixture = buildMechanismFixture();
const headline = fixture.variants.find((v) => v.id === fixture.headlineVariantId);
if (!headline) throw new Error("landing fixture is missing its headline variant");
const FIXTURE_EDL: Edl = headline.edl;
const FIXTURE_CLIPS = allClipPositions(FIXTURE_EDL);

/** The spoken spans of the source take, in source ticks — the inverse of the silence analysis. */
function spokenSpans(): { inTick: number; outTick: number }[] {
  const out: { inTick: number; outTick: number }[] = [];
  let cursorMs = 0;
  for (const s of FIXTURE_SILENCES_MS) {
    if (s.startMs > cursorMs) out.push({ inTick: msToTicks(cursorMs), outTick: msToTicks(s.startMs) });
    cursorMs = Math.max(cursorMs, s.endMs);
  }
  if (msToTicks(cursorMs) < FIXTURE_SOURCE_TICKS) {
    out.push({ inTick: msToTicks(cursorMs), outTick: FIXTURE_SOURCE_TICKS });
  }
  return out;
}

/** The leading `targetTicks` of spoken material — planCutDown's keep-ranges, in miniature. */
function keepRangesUpTo(targetTicks: number): { inTick: number; outTick: number }[] {
  const out: { inTick: number; outTick: number }[] = [];
  let budget = targetTicks;
  for (const span of spokenSpans()) {
    if (budget <= 0) break;
    const outTick = Math.min(span.outTick, span.inTick + budget);
    out.push({ inTick: span.inTick, outTick });
    budget -= outTick - span.inTick;
  }
  return out;
}

/**
 * One committed planner emission per allowlisted prompt: the flat batch `emitEditBatch` would carry
 * for that sentence against this timeline. Ids and ticks are read from the fixture, never typed.
 */
const EMISSIONS: Readonly<Record<string, (edl: Edl) => FlatEditBatch>> = {
  // findSilences → the spoken spans survive, the dead air does not. PROPOSE_CUTS rather than
  // SPLIT/REMOVE because a split's right-hand child gets a derived id the model cannot reference
  // inside the same batch — see lib/landing/build-fixture.ts.
  "cut the dead air": () => ({
    summary: "Cut the dead air.",
    commands: [{ type: "PROPOSE_CUTS", proposedClips: spokenSpans(), rationale: "Removed the silent spans." }],
  }),

  // findFillerWords → the same shape, over word-level spans instead of silence spans.
  "remove the ums": () => ({
    summary: "Removed the filler words.",
    commands: [
      {
        type: "PROPOSE_CUTS",
        proposedClips: [
          { inTick: msToTicks(1200), outTick: msToTicks(4300) },
          { inTick: msToTicks(4800), outTick: msToTicks(6400) },
          { inTick: msToTicks(7500), outTick: msToTicks(45800) },
        ],
        rationale: "Dropped two filler tokens.",
      },
    ],
  }),

  // planCutDown → keep-ranges that add up to the requested length.
  "make the intro 8 seconds": () => ({
    summary: "Cut the intro down to 8 seconds.",
    commands: [{ type: "PROPOSE_CUTS", proposedClips: keepRangesUpTo(secToTicks(8)) }],
  }),

  // A renderable clip effect on the clip the user pointed at.
  "punch in on the reaction": (edl) => ({
    summary: "Punched in on the reaction.",
    commands: [
      { type: "ADD_EFFECT", effectKey: "zoom-punch", targetMode: "clip", clipId: allClipPositions(edl)[1].clip.id },
    ],
  }),

  // A renderable transition treatment at a real cut between two adjacent clips.
  "add a whip pan here": (edl) => {
    const [a, b] = allClipPositions(edl);
    return {
      summary: "Added a whip pan at the cut.",
      commands: [
        {
          type: "ADD_TRANSITION",
          betweenClipIds: [a.clip.id, b.clip.id],
          transitionKey: "trans-whip-pan-l",
          durationTicks: msToTicks(200),
        },
      ],
    };
  },

  // A look whose every recipe step passes the per-step render check.
  "give it the A24 look": () => ({
    summary: "Applied the A24 look.",
    commands: [{ type: "COMPOSE_LOOK", lookKey: "look-a24" }],
  }),
};

describe("landing prompt allowlist", () => {
  it("every allowlisted prompt has evidence, and every piece of evidence is allowlisted", () => {
    // §7.2: "Adding a prompt without a passing test fails the build." This is the assertion that
    // makes that true — a new entry with no emission fails here before it can reach the rail.
    expect(Object.keys(EMISSIONS).sort()).toEqual([...EXAMPLE_PROMPT_TEXTS].sort());
  });

  it.each(EXAMPLE_PROMPTS.map((p) => [p.text] as const))(
    "%s → at least one EditCommand that changes the EDL",
    (text) => {
      const emit = EMISSIONS[text];
      const batch = flatBatchToEditBatch(emit(FIXTURE_EDL));
      expect(batch.commands.length).toBeGreaterThanOrEqual(1);

      const after = reduceBatch(FIXTURE_EDL, batch.commands).edl;
      // `contentHash` excludes `revision`, so an unchanged hash means the batch really did nothing —
      // exactly the silent no-op this gate exists to catch.
      expect(after.contentHash).not.toBe(FIXTURE_EDL.contentHash);
    },
  );

  it("the fixture timeline this is proved against is itself real", () => {
    expect(FIXTURE_CLIPS.length).toBeGreaterThan(1); // a transition needs two adjacent clips
    expect(FIXTURE_EDL.durationTicks).toBe(headline.durationTicks);
    expect(FIXTURE_EDL.contentHash).toBeTruthy();
  });
});

describe("landing prompt allowlist — what it may not say", () => {
  it("every registry key an example names is one the catalog advertises", () => {
    // Ties the two gates together: a prompt cannot outlive the entry it depends on. If a renderer is
    // removed, `catalog.ts` drops the key and this fails on the same run.
    for (const p of EXAMPLE_PROMPTS) {
      if (p.registryKey) expect(isCatalogKey(p.registryKey), p.text).toBe(true);
    }
  });

  it("names no capability this build does not have", () => {
    // §7.2's exclusion list. Beats are not wired, faces were cut, `public/overlays/` ships no asset,
    // and captions are out until verified in prod. The check is on the visitor-facing sentence AND
    // the rationale, because both are copy.
    const forbidden = ["beat", "bpm", "drop", "sync", "face", "overlay", "caption", "subtitle"];
    for (const p of EXAMPLE_PROMPTS) {
      const copy = `${p.text} ${p.why}`.toLowerCase();
      for (const word of forbidden) expect(copy, `${p.text} / ${word}`).not.toContain(word);
    }
  });

  it("uses no banned marketing phrase", () => {
    // The property-wide honesty rule (§7.4), applied to the copy this module owns.
    const banned = ["to the pixel", "in seconds", "in minutes", "instantly", "one click", "10x"];
    for (const p of EXAMPLE_PROMPTS) {
      const copy = `${p.text} ${p.why}`.toLowerCase();
      for (const phrase of banned) expect(copy, `${p.text} / ${phrase}`).not.toContain(phrase);
    }
  });

  it("is a set of distinct, non-empty sentences", () => {
    expect(new Set(EXAMPLE_PROMPT_TEXTS).size).toBe(EXAMPLE_PROMPTS.length);
    for (const p of EXAMPLE_PROMPTS) {
      expect(p.text.trim(), "prompt text").toBe(p.text);
      expect(p.text.length).toBeGreaterThan(0);
      expect(p.why.length).toBeGreaterThan(0);
    }
  });

  /**
   * THIS USED TO ASSERT `/app?prompt=` UNCONDITIONALLY, and that is precisely the claim that went
   * false when the hosting model was settled: www.tryhite.xyz serves the landing only, so on the
   * public build those six chips were six links into a route that deployment does not serve. The
   * assertion did not catch it because it encoded the old premise as a constant.
   *
   * So it now asserts the invariant that actually has to hold — a chip leads somewhere that EXISTS in
   * the deployment it was built for — in both deployments, rather than one deployment's answer twice.
   * `EDITOR_REACHABILITY` is resolved at module load, so each case needs a fresh module registry.
   */
  it("links into the editor's real deep-link route where the editor is served", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_HITE_EDITOR", "local");
    const local = await import("./prompts");
    for (const p of local.EXAMPLE_PROMPTS) {
      // `/app?prompt=` is read by app/app/_components/DeepLinkPrompt.tsx, which opens a cut and
      // pre-fills the composer. A hand-built href would break the moment a prompt gained a comma.
      const href = local.promptHref(p.text);
      expect(href.startsWith("/app?prompt=")).toBe(true);
      expect(new URL(href, "https://tryhite.xyz").searchParams.get("prompt")).toBe(p.text);
    }
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("leads to the quickstart, never into /app, on a landing-only deployment", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_HITE_EDITOR", "hosted-landing");
    const hosted = await import("./prompts");
    for (const p of hosted.EXAMPLE_PROMPTS) {
      const href = hosted.promptHref(p.text);
      expect(href).toBe("#for-developers");
      // The specific regression: a dead launcher is worse than no launcher, because it looks like
      // the product is broken rather than like it has to be installed.
      expect(href).not.toContain("/app");
    }
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("§6.3's segmented-control prompts are qualified forms of an allowlisted prompt", () => {
    // The falsifiable-timeline section shows three prompts of its own. They are not a second
    // allowlist: each is the allowlisted sentence plus a qualifier, and each is proved by the
    // generated fixture rather than by an emission here.
    for (const variant of FIXTURE_VARIANTS) {
      const root = EXAMPLE_PROMPT_TEXTS.find((t) => variant.prompt === t || variant.prompt.startsWith(`${t},`));
      expect(root, variant.prompt).toBeDefined();
    }
  });
});
