import { describe, expect, test } from "vitest";
import { runSearchRegistry } from "./searchRegistry";

// Runs against the real public/registry/manifest.json (built by predev/prebuild).
describe("searchRegistry", () => {
  test("finds a known key by keyword and returns its exact key", async () => {
    const r = await runSearchRegistry({ query: "saturation", limit: 12 });
    expect(r.count).toBeGreaterThan(0);
    expect(r.results.map((x) => x.key)).toContain("saturation-up");
  });

  test("honors the category filter", async () => {
    const r = await runSearchRegistry({ query: "", category: "transitions", limit: 50 });
    expect(r.count).toBeGreaterThan(0);
    expect(r.results.every((x) => x.category === "transitions")).toBe(true);
  });

  test("respects the limit", async () => {
    const r = await runSearchRegistry({ query: "", limit: 3 });
    expect(r.results.length).toBeLessThanOrEqual(3);
  });
});
