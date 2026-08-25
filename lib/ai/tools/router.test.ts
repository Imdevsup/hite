import { describe, it, expect } from "vitest";
import { selectToolSpecs, selectTools, toolGuide, matchedTiers } from "./router";
import { TOOL_REGISTRY } from "./registry";

/**
 * The router is the "which tool when" layer: it trims the library to a relevant subset per request.
 *
 * The prompts below are not invented — they are the exact requests that were observed failing at
 * runtime, plus the product's own marketing copy. Each one used to either strand a capability the
 * request needed or widen to the whole registry, past the ~16-tool accuracy cliff this router
 * exists to stay under.
 */

/** Tools past this count are where LLM tool-selection accuracy collapses (router.ts's whole point). */
const DEGRADATION_CLIFF = 16;
const names = (prompt: string) => selectToolSpecs(prompt).map((s) => s.name);

describe("tool router", () => {
  it("routing is active — the library exceeds the threshold", () => {
    expect(TOOL_REGISTRY.length).toBeGreaterThan(DEGRADATION_CLIFF);
  });

  it("always exposes the registry tier (key resolution)", () => {
    expect(names("make it warm")).toContain("searchRegistry");
  });

  it("a color prompt surfaces color tools, trimmed below the full set", () => {
    const specs = selectToolSpecs("give it a warm cinematic A24 color grade");
    expect(specs.map((s) => s.name)).toContain("suggestColorGrade");
    expect(specs.length).toBeLessThan(TOOL_REGISTRY.length);
  });

  it("a beat prompt surfaces rhythm tools", () => {
    expect(names("cut it on the beat, phonk punch-ins")).toEqual(expect.arrayContaining(["planBeatCuts", "analyzeBeats"]));
  });

  it("a speech prompt surfaces speech tools", () => {
    const picked = names("cut the ums and dead air");
    expect(picked.some((n) => ["findFillerWords", "findSilences", "analyzeTranscript"].includes(n))).toBe(true);
  });

  it("selectTools returns a name→tool map and toolGuide lists whenToUse", () => {
    expect(Object.keys(selectTools("color grade")).length).toBeGreaterThan(0);
    expect(toolGuide(selectToolSpecs("color grade"))).toMatch(/suggestColorGrade:/);
  });
});

describe("compound prompts keep EVERY matched tier", () => {
  it('"sync the cuts to the music and add subtitles" exposes transcript AND beat tools', () => {
    // Observed failure: this returned rhythm + registry only. "subtitles" missed `\bsubtitle\b` and
    // "cuts" missed `\bcut\b`, so the model had to fabricate the caption text or drop half the ask.
    const picked = names("sync the cuts to the music and add subtitles");
    expect(picked).toContain("analyzeBeats");
    expect(picked.some((n) => ["analyzeTranscript", "suggestCaptionStyle", "findFillerWords"].includes(n))).toBe(true);
    expect(matchedTiers("sync the cuts to the music and add subtitles")).toEqual(
      expect.arrayContaining(["rhythm", "speech", "text", "structure"]),
    );
  });

  it('"add a skull overlay when the beat drops" exposes the overlay advisor', () => {
    const picked = names("add a skull overlay when the beat drops");
    expect(picked).toContain("suggestOverlay");
    expect(picked).toContain("analyzeBeats");
  });

  it("a three-part request keeps all three tiers, not the strongest one", () => {
    const picked = names("tighten the pacing, warm up the grade and add captions");
    expect(picked).toContain("suggestColorGrade");
    expect(picked).toContain("suggestCaptionStyle");
    expect(picked).toContain("suggestPacing");
  });
});

describe("plurals and verb forms hit the same tiers as the singular", () => {
  const pairs: Array<[string, string, string]> = [
    ["add a caption", "add captions", "suggestCaptionStyle"],
    ["add a subtitle", "add subtitles", "suggestCaptionStyle"],
    ["cut on the beat", "cut on the beats", "analyzeBeats"],
    ["cut the scene", "cut the scenes", "analyzeScenes"],
    ["make the cut tighter", "make the cuts tighter", "analyzeScenes"],
    ["add a transition", "add transitions", "suggestTransition"],
    ["find the silence", "find the silences", "findSilences"],
  ];

  for (const [singular, plural, expected] of pairs) {
    it(`"${plural}" routes like "${singular}"`, () => {
      expect(names(singular)).toContain(expected);
      expect(names(plural)).toContain(expected);
    });
  }

  it('"add captions" — the product\'s own example — no longer widens to the whole registry', () => {
    const picked = selectToolSpecs("add captions");
    expect(picked.length).toBeLessThan(TOOL_REGISTRY.length);
    expect(picked.length).toBeLessThanOrEqual(DEGRADATION_CLIFF);
  });
});

describe("a small matched tier is trusted — never widened to everything", () => {
  it('"make the vocals punchier" gets the audio advisor and stays tiny', () => {
    // Used to widen to all 22 tools because registry(2) + audio(1) < MIN_PICKED(4).
    const picked = selectToolSpecs("make the vocals punchier");
    expect(picked.map((s) => s.name)).toContain("suggestAudioFx");
    expect(picked.length).toBeLessThanOrEqual(DEGRADATION_CLIFF);
    expect(picked.length).toBeLessThan(TOOL_REGISTRY.length);
  });
});

describe("a prompt matching nothing gets a curated subset, not the whole library", () => {
  for (const vague of ["make it pop", "do your thing", "zzzz", "make this cooler"]) {
    it(`"${vague}" stays under the degradation cliff and still has the registry tier`, () => {
      const picked = selectToolSpecs(vague);
      expect(picked.length).toBeLessThan(TOOL_REGISTRY.length);
      expect(picked.length).toBeLessThanOrEqual(DEGRADATION_CLIFF);
      expect(picked.map((s) => s.name)).toContain("searchRegistry");
      // Usable, not stranded: the aesthetic advisors are what these requests always mean.
      expect(picked.map((s) => s.name)).toContain("suggestLook");
      expect(picked.length).toBeGreaterThanOrEqual(4);
    });
  }

  it("and the fallback is not aesthetic-ONLY — a vague ask may well be structural", () => {
    // Regression: DEFAULT_TIERS was [color, motion], so every unanticipated phrasing was answered
    // with four advisors that recolour and add transitions, and NO tool that can cut anything.
    // "clean it up" / "make it snappier" are trims, not grades.
    for (const vague of ["make it snappier", "clean it up", "zzzz"]) {
      const picked = names(vague);
      expect(picked, `${vague} — aesthetic reading`).toContain("suggestLook");
      expect(picked, `${vague} — structural reading`).toContain("planCutDown");
      expect(picked, `${vague} — speech reading`).toContain("findSilences");
      // Still under the cliff, emitEditBatch included.
      expect(picked.length + 1, vague).toBeLessThanOrEqual(DEGRADATION_CLIFF);
    }
  });
});

describe("a structural request is never answered with only the aesthetic advisors", () => {
  /**
   * The four prompts below are ordinary ways to ask for a trim and they matched NO tier at all, so
   * the fallback handed each of them suggestColorGrade/suggestLook/suggestMotionFx/suggestTransition
   * and not one analysis tool — "get rid of the awkward gaps" is verbatim findSilences' own use case.
   */
  const structural: Array<[string, string]> = [
    ["remove the boring parts", "planCutDown"],
    ["get rid of the awkward gaps", "findSilences"],
    ["trim the fat", "planCutDown"],
    ["take out the rambling", "analyzeTranscript"],
  ];

  for (const [prompt, expected] of structural) {
    it(`"${prompt}" reaches ${expected}`, () => {
      const picked = names(prompt);
      expect(picked).toContain(expected);
      expect(picked.length + 1, prompt).toBeLessThanOrEqual(DEGRADATION_CLIFF);
    });
  }
});

describe("a stem that ends in -e still matches its -ing form", () => {
  // `\w{0,3}` is appended to the WHOLE stem, so "ramble" could never match "rambling". Every one of
  // these prompts matched nothing at all and fell through to the fallback.
  const pairs: Array<[string, string]> = [
    ["less rambling please", "analyzeTranscript"],
    ["fix the mumbling", "findFillerWords"],
    ["try dissolving between them", "suggestTransition"],
    ["keep it grooving", "analyzeBeats"],
    ["condensing it would be better", "planCutDown"],
  ];

  for (const [prompt, expected] of pairs) {
    it(`"${prompt}" matches a tier on its own, not via the fallback`, () => {
      expect(matchedTiers(prompt).length, prompt).toBeGreaterThan(0);
      expect(names(prompt)).toContain(expected);
    });
  }
});

describe("the router never hands the model more than it can choose between", () => {
  const prompts = [
    "make it pop",
    "add captions",
    "cut the filler words and the dead air",
    "sync the cuts to the music and add subtitles",
    "tighten the pacing, warm up the grade and add captions",
  ];
  for (const prompt of prompts) {
    it(`"${prompt}" → ≤ ${DEGRADATION_CLIFF} tools`, () => {
      // +1 for emitEditBatch, which the planner appends to whatever the router returns.
      expect(selectToolSpecs(prompt).length + 1).toBeLessThanOrEqual(DEGRADATION_CLIFF);
    });
  }

  it("a request that genuinely asks for everything keeps every tier rather than truncating", () => {
    // The cap is a heuristic; stranding a capability the user explicitly asked for is a bug. When a
    // prompt really does span six tiers, all six are exposed — still fewer than the full library,
    // and the alternative (dropping one) is the exact failure this router was fixed for.
    const prompt = "make a 60s vertical cut for tiktok with beat-synced cuts, captions and a warm grade";
    const picked = names(prompt);
    expect(matchedTiers(prompt)).toEqual(
      expect.arrayContaining(["speech", "rhythm", "structure", "color", "text", "planning"]),
    );
    for (const tool of ["analyzeBeats", "suggestCaptionStyle", "suggestColorGrade", "planCutDown"]) {
      expect(picked, tool).toContain(tool);
    }
    expect(picked.length).toBeLessThan(TOOL_REGISTRY.length);
  });
});
