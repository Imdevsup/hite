import { describe, expect, test } from "vitest";
import { TOOL_REGISTRY, type ToolSpec } from "./registry";
import { runSearchRegistry } from "./searchRegistry";
import { isRenderableEntry } from "./renderableEntry";
import { validateManifest } from "@/lib/registry/catalog";
import manifestData from "@/public/registry/manifest.json";

/**
 * The advisors, driven end-to-end against the REAL manifest and the REAL renderer registry — no
 * mocks, because the bug being pinned was precisely that the advisors' idea of "a real key" and the
 * renderer's differed. Every key any advisor hands the model must be one the pipeline paints;
 * otherwise the model emits it, the reducer stores it, the chat says "done", and the video is
 * pixel-identical.
 */

const catalog = validateManifest(manifestData);
const spec = (name: string): ToolSpec => {
  const found = TOOL_REGISTRY.find((s) => s.name === name);
  if (!found) throw new Error(`${name} is not in the tool registry`);
  return found;
};

interface Suggestion {
  key: string;
  name: string;
  description: string;
}
interface AdvisorResult {
  suggestions: Suggestion[];
  note?: string;
}

/** Invoke the REGISTERED tool the way the planner does. The cast is the tool's untyped I/O boundary. */
async function advise(name: string, input: unknown): Promise<AdvisorResult> {
  const execute = spec(name).tool.execute;
  if (!execute) throw new Error(`${name} has no execute`);
  return (await execute(input, { toolCallId: "t", messages: [] })) as AdvisorResult;
}

const keys = (r: AdvisorResult) => r.suggestions.map((s) => s.key);

describe("suggestAudioFx — the capability that does not exist", () => {
  test("returns nothing, because no audio effect renders in this build", async () => {
    const result = await advise("suggestAudioFx", { intent: "punchy warm vocals" });
    expect(result.suggestions).toEqual([]);
  });

  test("and SAYS so, naming the withheld keys — an unexplained [] invites another guess", async () => {
    const result = await advise("suggestAudioFx", { intent: "punchy" });
    expect(result.note).toMatch(/compressor-vocal/);
    expect(result.note).toMatch(/do NOT use them/);
    expect(result.note).toMatch(/tell the user this build does not support it yet/);
  });
});

describe("suggestMotionFx", () => {
  test("still does its job for the glitch keys that DO render", async () => {
    const result = await advise("suggestMotionFx", { intent: "rgb split glitch flash" });
    expect(keys(result)).toContain("rgb-split-hard");
    expect(result.suggestions.every((s) => isRenderableEntry(catalog.find((e) => e.key === s.key)!))).toBe(true);
  });

  test('"lens flare" no longer returns the procedural keys nothing paints', async () => {
    const result = await advise("suggestMotionFx", { intent: "lens flare" });
    expect(keys(result)).not.toContain("proc-lens-flare-warm");
    expect(keys(result)).not.toContain("proc-lens-flare-cool");
    expect(result.note).toMatch(/proc-lens-flare/);
  });
});

describe("suggestTransition", () => {
  test("the honest transitions still come back", async () => {
    expect(keys(await advise("suggestTransition", { style: "whip" }))).toContain("trans-whip-pan-l");
    expect(keys(await advise("suggestTransition", { style: "flash" }))).toContain("trans-flash-cut");
  });

  test('"crossfade" returns nothing, and explains that v1 cannot blend two clips', async () => {
    const result = await advise("suggestTransition", { style: "crossfade" });
    expect(keys(result)).not.toContain("trans-crossfade");
    expect(result.note).toMatch(/would not look like its name/);
  });

  test("a plain `fade` request still gets the transition that IS a dip through black", async () => {
    expect(keys(await advise("suggestTransition", { style: "fade" }))).toContain("trans-fade");
  });
});

describe("suggestLook — a look with one dead step is not offered", () => {
  test("the looks that fully apply are still suggested", async () => {
    expect(keys(await advise("suggestLook", { vibe: "a24" }))).toContain("look-a24");
    expect(keys(await advise("suggestLook", { vibe: "cinema-warm" }))).toContain("look-cinema-warm");
  });

  test('"skull" no longer returns the look that compiles to zero steps', async () => {
    const result = await advise("suggestLook", { vibe: "skull" });
    expect(keys(result)).not.toContain("look-skull-face-drop");
    expect(result.note).toMatch(/analysis this build does not produce/);
  });

  test('"vhs" no longer returns the look with an unrenderable recipe step', async () => {
    const result = await advise("suggestLook", { vibe: "vhs dream" });
    expect(keys(result)).not.toContain("look-vhs-dream");
  });
});

describe("browseRegistry — the widest hole, because it enumerates everything", () => {
  test("browsing `audio` returns an empty catalogue plus the reason", async () => {
    const result = await advise("browseRegistry", { category: "audio" });
    expect(result.suggestions).toEqual([]);
    expect(result.note).toMatch(/no renderer/);
  });

  test("browsing `transitions` returns only the honest subset", async () => {
    const result = await advise("browseRegistry", { category: "transitions" });
    const all = catalog.filter((e) => e.category === "transitions");
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions.length).toBeLessThan(all.length);
    expect(keys(result)).not.toContain("trans-crossfade");
  });

  test("browsing `looks` returns only the looks that fully apply", async () => {
    expect(keys(await advise("browseRegistry", { category: "looks" }))).toEqual([
      "look-a24",
      "look-brutalist-mono",
      "look-casey-jump",
      "look-cinema-warm",
      "look-document",
    ]);
  });
});

describe("searchRegistry is gated too — it is the tool the prompt tells the model to trust", () => {
  test("a keyword that only matches dead audio keys returns nothing", async () => {
    const result = await runSearchRegistry({ query: "reverb", limit: 12 });
    expect(result.results).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("searching a withheld transition by name returns nothing", async () => {
    const result = await runSearchRegistry({ query: "crossfade", limit: 12 });
    expect(result.results.map((r) => r.key)).not.toContain("trans-crossfade");
  });

  test("real keys still resolve", async () => {
    const result = await runSearchRegistry({ query: "a24", limit: 12 });
    expect(result.results.map((r) => r.key)).toContain("lut-a24-moonlight");
  });
});

describe("what the gate must NOT delete", () => {
  test("overlays still resolve — they render through ADD_OVERLAY, not the effect map", async () => {
    expect(keys(await advise("suggestOverlay", { kind: "skull" }))).toContain("overlay-skull");
    expect(keys(await advise("suggestOverlay", { kind: "light leak" }))).toContain("overlay-light-leak");
    expect(keys(await advise("browseRegistry", { category: "overlays" }))).toHaveLength(4);
  });

  test("caption styles still resolve — they render through ADD_CAPTION", async () => {
    const result = await advise("suggestCaptionStyle", { vibe: "bold" });
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(keys(result)).toContain("text-lower-third-basic");
  });

  test("color grades are untouched — every one of them renders", async () => {
    const result = await advise("suggestColorGrade", { intent: "warm cinematic" });
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.note).toBeUndefined();
  });
});

describe("the invariant, swept across the advisors", () => {
  const probes: Array<[string, unknown]> = [
    ["suggestAudioFx", { intent: "punchy" }],
    ["suggestMotionFx", { intent: "lens flare glitch zoom punch" }],
    ["suggestTransition", { style: "" }],
    ["suggestTransition", { style: "cube rotate" }],
    ["suggestLook", { vibe: "skull vhs a24 brutalist document casey warm" }],
    ["suggestOverlay", { kind: "skull leak lightning scan" }],
    ["suggestCaptionStyle", {}],
    ["suggestColorGrade", { intent: "warm cold vintage contrast vignette grain" }],
    ["browseRegistry", { category: "procedural" }],
    ["browseRegistry", { category: "glitch" }],
    ["browseRegistry", { category: "luts" }],
    ["browseRegistry", { category: "color" }],
    ["browseRegistry", { category: "text" }],
  ];

  for (const [name, input] of probes) {
    test(`${name}(${JSON.stringify(input)}) never suggests a key the pipeline would ignore`, async () => {
      for (const key of keys(await advise(name, input))) {
        const entry = catalog.find((e) => e.key === key);
        expect(entry, `${key} is not even in the manifest`).toBeDefined();
        expect(isRenderableEntry(entry!), key).toBe(true);
      }
    });
  }

  test("and neither does searchRegistry, across every category", async () => {
    for (const query of ["fade", "warm", "glitch", "skull", "reverb", "flare", "caption", "zoom", "vhs"]) {
      for (const r of (await runSearchRegistry({ query, limit: 50 })).results) {
        const entry = catalog.find((e) => e.key === r.key);
        expect(isRenderableEntry(entry!), `${query} → ${r.key}`).toBe(true);
      }
    }
  });
});
