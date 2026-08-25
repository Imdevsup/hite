import { describe, expect, test } from "vitest";
import { overlayFamily, hasProceduralOverlay } from "./OverlayProcedural";

describe("overlayFamily", () => {
  test("classifies the registry overlay keys", () => {
    expect(overlayFamily("overlay-scan-lines")).toBe("scanlines");
    expect(overlayFamily("overlay-light-leak")).toBe("lightleak");
    expect(overlayFamily("overlay-lightning")).toBe("lightning");
    expect(overlayFamily("overlay-skull")).toBe("drop");
  });

  test("unknown overlay → none (falls back to an asset url)", () => {
    expect(overlayFamily("overlay-some-future-pack")).toBe("none");
    expect(overlayFamily("system-watermark")).toBe("none");
  });
});

describe("hasProceduralOverlay", () => {
  test("true for the four shipped procedural families, false otherwise", () => {
    expect(hasProceduralOverlay("overlay-scan-lines")).toBe(true);
    expect(hasProceduralOverlay("overlay-light-leak")).toBe(true);
    expect(hasProceduralOverlay("overlay-lightning")).toBe(true);
    expect(hasProceduralOverlay("overlay-skull")).toBe(true);
    expect(hasProceduralOverlay("overlay-unknown")).toBe(false);
  });

  test("the registry's overlay-asset keys are all covered (no 404 path for them)", () => {
    // These are the keys look recipes + the overlays palette reference; every one must be procedural
    // so it never points OffthreadVideo at a missing public/overlays/ asset.
    for (const key of ["overlay-skull", "overlay-scan-lines", "overlay-light-leak", "overlay-lightning"]) {
      expect(hasProceduralOverlay(key), key).toBe(true);
    }
  });
});
