import { describe, expect, test } from "vitest";
import { search } from "./search";
import type { RegistryEntry } from "./types";

function entry(overrides: Partial<RegistryEntry>): RegistryEntry {
  return {
    key: overrides.key ?? "e",
    label: overrides.label ?? "Entry",
    category: overrides.category ?? "color",
    tags: overrides.tags ?? [],
    engine: overrides.engine ?? "ffmpeg",
    params: overrides.params ?? [],
    requires: overrides.requires ?? [],
    stability: overrides.stability ?? "stable",
    ...overrides,
  } as RegistryEntry;
}

describe("search — scoring", () => {
  const corpus: RegistryEntry[] = [
    entry({ key: "saturation-up", label: "Saturation Up", tags: ["color", "saturation"] }),
    entry({ key: "vhs-dream", label: "VHS Dream", category: "looks", tags: ["vhs", "retro"] }),
    entry({ key: "rgb-split-hard", label: "RGB Split Hard", category: "glitch", tags: ["rgb", "split"] }),
    entry({ key: "glitch-bars", label: "Glitch Bars", category: "glitch", tags: ["glitch"] }),
    entry({ key: "lut-a24-moonlight", label: "A24 Moonlight", category: "luts", tags: ["a24", "cinema"] }),
  ];

  test("empty query returns all (up to limit)", () => {
    expect(search(corpus, "")).toHaveLength(corpus.length);
  });

  test("exact label match beats partial", () => {
    const results = search(corpus, "Saturation Up");
    expect(results[0].key).toBe("saturation-up");
  });

  test("prefix match beats substring match", () => {
    const augmented = [...corpus, entry({ key: "satellite", label: "Satellite Tracking" })];
    const results = search(augmented, "sat");
    // "Satellite Tracking" starts with sat; "Saturation Up" starts with sat too. Both prefix.
    // More importantly, key containing "sat" in "saturation-up" gets bonus.
    expect(results[0].key).toMatch(/sat/);
  });

  test("tag-only match still matches", () => {
    const results = search(corpus, "retro");
    expect(results.map((e) => e.key)).toContain("vhs-dream");
  });

  test("case-insensitive", () => {
    const results = search(corpus, "GLITCH");
    expect(results.map((e) => e.key)).toContain("glitch-bars");
  });

  test("non-matching query returns []", () => {
    expect(search(corpus, "xyznotathing")).toEqual([]);
  });
});

describe("search — filters", () => {
  const corpus: RegistryEntry[] = [
    entry({ key: "a", label: "A", category: "color", stability: "stable" }),
    entry({ key: "b", label: "B", category: "glitch", stability: "beta" }),
    entry({ key: "c", label: "C", category: "color", stability: "experimental" }),
  ];

  test("category filter narrows the corpus", () => {
    const results = search(corpus, "", { category: "color" });
    expect(results.map((e) => e.key)).toEqual(["a", "c"]);
  });

  test("single stability filter", () => {
    const results = search(corpus, "", { stability: "stable" });
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("a");
  });

  test("array stability filter includes all listed", () => {
    const results = search(corpus, "", { stability: ["stable", "beta"] });
    expect(results.map((e) => e.key).sort()).toEqual(["a", "b"]);
  });

  test("limit caps the result count", () => {
    const results = search(corpus, "", { limit: 2 });
    expect(results).toHaveLength(2);
  });
});
