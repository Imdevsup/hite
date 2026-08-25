import { describe, expect, test } from "vitest";
import { assertAssetAllowed } from "./_guard";

describe("assertAssetAllowed", () => {
  test("allows an asset that is in the allowlist", () => {
    expect(() => assertAssetAllowed("a1", { allowedAssetIds: ["a1", "a2"] })).not.toThrow();
  });

  test("rejects an asset outside the allowlist (cross-tenant IDOR guard)", () => {
    expect(() => assertAssetAllowed("evil", { allowedAssetIds: ["a1", "a2"] })).toThrow(
      /not part of the current project/,
    );
  });

  test("refuses when the context carries no allowlist — the guard fails CLOSED", () => {
    // This used to pass anything through, so the IDOR protection depended on every caller
    // remembering to populate an unstable SDK field. An unscoped call is now a refusal.
    for (const ctx of [undefined, null, {}, { allowedAssetIds: undefined }, { allowedAssetIds: "a1" }]) {
      expect(() => assertAssetAllowed("anything", ctx), JSON.stringify(ctx ?? null)).toThrow(/unscoped/);
    }
  });

  test("an EMPTY allowlist is a scope, and it permits nothing", () => {
    expect(() => assertAssetAllowed("a1", { allowedAssetIds: [] })).toThrow(
      /not part of the current project/,
    );
  });
});
