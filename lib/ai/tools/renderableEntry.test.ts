import { describe, expect, test } from "vitest";
import { isRenderableEntry, filterRenderable, partitionRenderableEntries, unrenderableReason, withheldNote } from "./renderableEntry";
import { validateManifest } from "@/lib/registry/catalog";
import { isRenderableEffectKey } from "@/lib/remotion/renderable";
import type { RegistryEntry } from "@/lib/registry/types";
import manifestData from "@/public/registry/manifest.json";

/**
 * The gate between "the manifest advertises it" and "the video changes". Checked against the REAL
 * manifest so a newly-registered renderer widens it automatically and a newly-added dead entry
 * fails here instead of in a user's export.
 */
const catalog = validateManifest(manifestData);
const byKey = (key: string): RegistryEntry => {
  const entry = catalog.find((e) => e.key === key);
  if (!entry) throw new Error(`fixture drift: ${key} is not in the manifest`);
  return entry;
};

describe("effect-category entries follow the renderer registry", () => {
  test("every color/luts/glitch entry passes — these are what the palette and the AI use daily", () => {
    for (const e of catalog.filter((e) => ["color", "luts", "glitch"].includes(e.category))) {
      expect(isRenderableEntry(e), e.key).toBe(true);
    }
  });

  test("the audio + procedural entries are withheld — advertised, but nothing paints them", () => {
    const withheld = catalog
      .filter((e) => ["audio", "procedural"].includes(e.category) && !isRenderableEntry(e))
      .map((e) => e.key)
      .sort();
    expect(withheld).toEqual([
      "compressor-vocal",
      "eq-bright",
      "proc-lens-flare-cool",
      "proc-lens-flare-warm",
      "reverb-plate",
    ]);
    expect(unrenderableReason(byKey("reverb-plate"))).toMatch(/no renderer/);
  });

  test("the gate is DERIVED, not a second hand-written list", () => {
    for (const e of catalog.filter((e) => ["color", "luts", "glitch", "audio", "procedural"].includes(e.category))) {
      expect(isRenderableEntry(e), e.key).toBe(isRenderableEffectKey(e.key));
    }
  });
});

describe("transitions are gated on rendering as their own name", () => {
  test("the honest ones survive", () => {
    for (const key of ["trans-fade", "trans-flash-cut", "trans-burn-to-black", "trans-glitch-cut", "trans-whip-pan-l"]) {
      expect(isRenderableEntry(byKey(key)), key).toBe(true);
    }
  });

  test("the ones that would need the two clips' pixels blended are withheld", () => {
    for (const key of ["trans-crossfade", "trans-dissolve", "trans-wipe-left", "trans-zoom-in", "trans-cube-rotate-l"]) {
      expect(isRenderableEntry(byKey(key)), key).toBe(false);
    }
    expect(unrenderableReason(byKey("trans-crossfade"))).toMatch(/would not look like its name/);
  });

  test("some transitions survive — the gate must not empty the category", () => {
    const transitions = catalog.filter((e) => e.category === "transitions");
    const kept = filterRenderable(transitions);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(transitions.length);
  });
});

describe("a look with one dead step is a dead look", () => {
  test("the five looks whose every step lands are offered", () => {
    const kept = filterRenderable(catalog.filter((e) => e.category === "looks")).map((e) => e.key);
    expect(kept.sort()).toEqual([
      "look-a24",
      "look-brutalist-mono",
      "look-casey-jump",
      "look-cinema-warm",
      "look-document",
    ]);
  });

  test("look-vhs-dream is withheld: its recipe names an effectKey nothing renders", () => {
    // `audio-saturation-soft` is not even in the manifest — the look would apply 3 of its 4 steps
    // and report success.
    expect(unrenderableReason(byKey("look-vhs-dream"))).toMatch(/audio-saturation-soft.*no renderer/);
  });

  test("look-skull-face-drop is withheld: every step needs beat/face analysis nothing supplies", () => {
    // compile.ts drops each step whose {{dropMs…}}/{{faceId}} it cannot resolve, so this look
    // produces ZERO effects and ZERO overlays — a completely silent no-op.
    const reason = unrenderableReason(byKey("look-skull-face-drop"));
    expect(reason).toMatch(/analysis this build does not produce/);
    expect(reason).toMatch(/dropMs/);
  });

  test("`{{durationMs}}` alone does NOT disqualify a step — the compiler owns that one", () => {
    const durationOnly: RegistryEntry = {
      ...byKey("look-document"),
      key: "look-test-duration",
      recipe: [
        { type: "applyOverlay", overlayKey: "overlay-scan-lines", startMs: 0, endMs: "{{durationMs}}", params: {} },
      ],
    };
    expect(isRenderableEntry(durationOnly)).toBe(true);
  });

  test("an empty recipe is a no-op, not a look", () => {
    expect(isRenderableEntry({ ...byKey("look-a24"), key: "look-empty", recipe: [] })).toBe(false);
  });
});

describe("overlays and captions are NOT filtered on the effect-renderer predicate", () => {
  test("every overlay + text entry survives — they lower to ADD_OVERLAY / ADD_CAPTION, not ADD_EFFECT", () => {
    // Gating these on `isRenderableEffectKey` would delete working capability: HiteRoot paints
    // overlays through OverlayView and captions through CaptionView, neither of which is in the
    // effect renderer map.
    for (const e of catalog.filter((e) => ["overlays", "text"].includes(e.category))) {
      expect(isRenderableEntry(e), e.key).toBe(true);
      expect(isRenderableEffectKey(e.key), e.key).toBe(false);
    }
  });
});

describe("partition + the withheld note", () => {
  test("partition preserves order and splits on the gate", () => {
    const entries = [byKey("zoom-punch"), byKey("reverb-plate"), byKey("vignette-soft")];
    const { renderable, unrenderable } = partitionRenderableEntries(entries);
    expect(renderable.map((e) => e.key)).toEqual(["zoom-punch", "vignette-soft"]);
    expect(unrenderable.map((e) => e.key)).toEqual(["reverb-plate"]);
  });

  test("nothing withheld ⇒ no note (an unmatched query is just an empty list)", () => {
    expect(withheldNote([])).toBeUndefined();
  });

  test("the note names the keys, the reason, and forbids emitting them", () => {
    const note = withheldNote([byKey("compressor-vocal"), byKey("eq-bright")]);
    expect(note).toMatch(/compressor-vocal/);
    expect(note).toMatch(/eq-bright/);
    expect(note).toMatch(/do NOT use them/);
  });

  test("a long withheld list stays short enough to be cheap in context", () => {
    const note = withheldNote(catalog.filter((e) => e.category === "transitions" && !isRenderableEntry(e)));
    expect(note).toMatch(/\+\d+ more/);
    expect(note!.length).toBeLessThan(600);
  });
});
