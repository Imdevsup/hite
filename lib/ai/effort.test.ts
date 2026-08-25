import { describe, expect, test, afterEach, vi } from "vitest";
import {
  DEFAULT_EFFORT,
  EFFORT,
  EFFORT_LEVELS,
  clampEffort,
  deployerEffortCeiling,
  effectiveCeiling,
  effortProfileFor,
  isEffort,
  resolveEffort,
  rungCeiling,
  rungCeilingReason,
  type Effort,
} from "./effort";
import type { ProviderCapabilities } from "@/lib/ai/providers/types";

/**
 * The ladder is the contract three other modules read (the planner's stop condition, the routes'
 * clamp, the provider option translator), so these tests pin the NUMBERS, not just the shape.
 *
 * The one thing that changed with multi-provider BYOK: the ladder no longer owns a MODEL. It used to
 * hardcode `gemini-2.5-pro` at `max`, which 404s for new accounts and on free-tier keys — a top rung
 * that was dead on arrival for exactly the users most likely to reach for it. The ceiling is now
 * derived from what the chosen provider can actually do.
 */

/** A provider that enforces `toolChoice` and can express every intent — i.e. the seven keyed ones. */
const FULL: ProviderCapabilities = {
  toolCalling: true,
  toolStreaming: true,
  toolChoice: true,
  thinking: ["off", "low", "medium", "high", "dynamic"],
};

/** A self-hosted OpenAI-compatible endpoint: accepts `tool_choice` and silently ignores it. */
const NO_TOOL_CHOICE: ProviderCapabilities = { ...FULL, toolChoice: false, thinking: [] };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the ladder", () => {
  test("draft is genuinely cheap: thinking OFF, one shot, no grounding floor", () => {
    const p = EFFORT.draft;
    expect(p.thinking).toBe("off"); // NOT absent — several models think dynamically when unset
    expect(p.steps).toBe(5);
    expect(p.revisions).toBe(0);
    expect(p.groundSteps).toBe(0);
  });

  test("standard adds auto-repair — a valid batch costs nothing extra", () => {
    const p = EFFORT.standard;
    expect(p.thinking).toBe("low");
    expect(p.steps).toBe(10);
    expect(p.revisions).toBe(1);
    expect(p.repairOnly).toBe(true); // re-prompt ONLY when the dry run failed
  });

  test("high critiques a VALID batch and forces grounding first", () => {
    const p = EFFORT.high;
    expect(p.thinking).toBe("high");
    expect(p.steps).toBe(18);
    expect(p.revisions).toBe(2);
    expect(p.repairOnly).toBe(false);
    expect(p.groundSteps).toBe(2);
    expect(p.toolGuidance).toContain("INVESTIGATE FIRST");
  });

  test("max is dynamic thinking and three revisions — and names no model at all", () => {
    const p = EFFORT.max;
    expect(p.thinking).toBe("dynamic");
    expect(p.revisions).toBe(3);
    expect(p.groundSteps).toBe(3);
    // REGRESSION GUARD: `max` used to carry `model: "gemini-2.5-pro"`. A rung is a SHAPE; the user
    // picks the model. Re-adding one would resurrect a top rung that 404s on a free-tier key.
    expect(p).not.toHaveProperty("model");
    expect(JSON.stringify(EFFORT)).not.toContain("gemini");
  });

  test("effort is monotonic — every lever grows or holds as the level rises", () => {
    for (let i = 1; i < EFFORT_LEVELS.length; i++) {
      const lo = EFFORT[EFFORT_LEVELS[i - 1]];
      const hi = EFFORT[EFFORT_LEVELS[i]];
      expect(hi.steps).toBeGreaterThan(lo.steps);
      expect(hi.revisions).toBeGreaterThanOrEqual(lo.revisions);
      expect(hi.groundSteps).toBeGreaterThanOrEqual(lo.groundSteps);
      expect(hi.wallClockMs).toBeGreaterThan(lo.wallClockMs);
    }
  });

  test("every level's wall-clock budget fits inside the routes' 300s maxDuration", () => {
    for (const level of EFFORT_LEVELS) expect(EFFORT[level].wallClockMs).toBeLessThan(300_000);
  });
});

describe("the level arrives per request and is never trusted raw", () => {
  test("absent or unrecognised falls back to the ONE default — there is one payer now", () => {
    expect(DEFAULT_EFFORT).toBe("high");
    for (const bad of [undefined, "ultra", "", null, 3, {}, ["high"], "HIGH"]) {
      expect(resolveEffort(bad), JSON.stringify(bad)).toBe("high");
    }
  });

  test("isEffort accepts exactly the four levels", () => {
    expect(EFFORT_LEVELS.every(isEffort)).toBe(true);
    expect(isEffort("ultra")).toBe(false);
  });

  test("clampEffort is min-by-rank", () => {
    expect(clampEffort("max", "draft")).toBe("draft");
    expect(clampEffort("draft", "max")).toBe("draft");
    expect(clampEffort("high", "high")).toBe("high");
  });
});

describe("the ceiling is DERIVED from the provider, not configured per vendor", () => {
  test("a provider that enforces toolChoice reaches the top rung", () => {
    expect(rungCeiling(FULL)).toBe("max");
    expect(rungCeilingReason(FULL)).toBeNull();
  });

  test("a provider that ignores toolChoice caps at the last UNGROUNDED rung", () => {
    // `prepareStep` withholds the emit tool during grounding and requires a tool call; the SDK loop
    // only continues after a step that made one. On a provider that ignores the instruction, a
    // grounding step answered with prose ends the turn with NO BATCH — "investigate first" becomes
    // "lose the edit". So the rung is refused rather than offered and quietly broken.
    const ceiling = rungCeiling(NO_TOOL_CHOICE);
    expect(EFFORT[ceiling].groundSteps).toBe(0);
    expect(EFFORT[nextLevel(ceiling)].groundSteps).toBeGreaterThan(0);
    expect(rungCeilingReason(NO_TOOL_CHOICE)).toContain("no edit at all");
  });

  test("a provider that cannot call tools cannot run the planner, and says so loudly", () => {
    expect(() => rungCeiling({ ...FULL, toolCalling: false })).toThrow(/cannot run the planner/);
  });

  test("the deployer's brake is a separate, optional clamp", () => {
    expect(deployerEffortCeiling()).toBeNull();
    expect(effectiveCeiling(FULL)).toBe("max");

    vi.stubEnv("HITE_BYOK_EFFORT_CEILING", "standard");
    expect(deployerEffortCeiling()).toBe("standard");
    expect(effectiveCeiling(FULL)).toBe("standard");
    expect(effortProfileFor("max", FULL).level).toBe("standard");
  });

  test("a garbage brake is ignored with a warning, not silently applied", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("HITE_BYOK_EFFORT_CEILING", "unlimited");
    expect(deployerEffortCeiling()).toBeNull();
    expect(warn.mock.calls.map(String).join(" ")).toContain("HITE_BYOK_EFFORT_CEILING");
    warn.mockRestore();
  });

  test("the tighter of the two ceilings wins, whichever it is", () => {
    vi.stubEnv("HITE_BYOK_EFFORT_CEILING", "high");
    expect(effectiveCeiling(NO_TOOL_CHOICE)).toBe("standard"); // provider binds
    expect(effectiveCeiling(FULL)).toBe("high"); // deployer binds
  });

  test("a level below the ceiling is left alone — the clamp is a max, not an override", () => {
    expect(effortProfileFor("draft", FULL).level).toBe("draft");
    expect(effortProfileFor("draft", NO_TOOL_CHOICE).level).toBe("draft");
  });
});

function nextLevel(level: Effort): Effort {
  const at = EFFORT_LEVELS.indexOf(level);
  return EFFORT_LEVELS[Math.min(at + 1, EFFORT_LEVELS.length - 1)];
}
