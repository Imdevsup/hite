import { describe, expect, test } from "vitest";
import { loadCatalog, byCategory, byKey, validateManifest, __resetCatalogCache } from "./catalog";

/**
 * Contract: the catalog is the pre-built manifest, imported as a MODULE (bundled
 * into every server function + the client). No filesystem read, no HTTP fetch —
 * so `searchRegistry` and the editor windows can't ENOENT in production.
 */

describe("loadCatalog — bundled manifest", () => {
  test("returns the real manifest, all entries valid", async () => {
    __resetCatalogCache();
    const catalog = await loadCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    // Every returned entry satisfies the RegistryEntry schema (validateManifest dropped any bad ones).
    for (const e of catalog) {
      expect(typeof e.key).toBe("string");
      expect(typeof e.category).toBe("string");
    }
  });

  test("caches — second call returns the same array reference", async () => {
    __resetCatalogCache();
    const a = await loadCatalog();
    const b = await loadCatalog();
    expect(b).toBe(a);
  });
});

describe("validateManifest", () => {
  test("drops invalid entries, keeps valid ones (never throws)", () => {
    const out = validateManifest([
      { key: "ok", label: "Ok", category: "color", tags: [], engine: "ffmpeg", ffmpegFilter: "eq", params: [], stability: "stable" },
      { key: "bad-no-label", category: "color" },
      "not-an-object",
      null,
    ]);
    expect(out.map((e) => e.key)).toEqual(["ok"]);
  });

  test("non-array input yields an empty list", () => {
    expect(validateManifest({})).toEqual([]);
    expect(validateManifest(null)).toEqual([]);
  });
});

describe("byCategory / byKey (against the real manifest)", () => {
  test("byCategory returns only entries of that category", async () => {
    const color = await byCategory("color");
    expect(color.length).toBeGreaterThan(0);
    expect(color.every((e) => e.category === "color")).toBe(true);
  });

  test("byKey returns a real key and null for a missing one", async () => {
    const all = await loadCatalog();
    const known = all[0].key;
    expect((await byKey(known))?.key).toBe(known);
    expect(await byKey("definitely-not-a-real-key-xyz")).toBeNull();
  });
});
