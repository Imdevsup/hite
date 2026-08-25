import { describe, expect, test, afterEach, vi } from "vitest";
import { GEMINI_MODEL, GOOGLE_SAFETY_SETTINGS, clampThinkingBudget, googleProviderOptions } from "./gemini";

/**
 * What is left of this file after the provider layer was generalized: the two facts that are
 * genuinely Google's and nobody else's.
 *
 * The rest of the old suite did not disappear, it MOVED with its subject — the request-amplification
 * policy is now `lib/ai/providers/fetch.test.ts` (and rotation is gone with the deployer key pool),
 * and the header/shape/redaction contract is `lib/ai/providers/credential.test.ts`.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("safety settings", () => {
  test("every category is BLOCK_NONE — a refused creative prompt is a lost edit", () => {
    // HITE is a creative video tool: "aggressive grade", "horror overlay", "violent drift energy" are
    // ordinary direction. The output is timeline commands, not generated media.
    expect(GOOGLE_SAFETY_SETTINGS.every((s) => s.threshold === "BLOCK_NONE")).toBe(true);
    expect(GOOGLE_SAFETY_SETTINGS).toHaveLength(5);
  });

  test("they ride along with every thinking intent", () => {
    for (const intent of ["off", "low", "medium", "high", "dynamic"] as const) {
      expect(JSON.stringify(googleProviderOptions("gemini-2.5-flash", intent)), intent).toContain("BLOCK_NONE");
    }
  });
});

describe("thinking budgets stay inside the model family's verified range", () => {
  test("2.5-pro can never be handed 0 — it cannot disable thinking, and 0 is a 400", () => {
    expect(clampThinkingBudget("gemini-2.5-pro", 0)).toBe(128);
    expect(clampThinkingBudget("gemini-2.5-pro", 99_999)).toBe(32_768);
    expect(clampThinkingBudget("gemini-2.5-pro", -1)).toBe(-1); // dynamic is legal
  });

  test("flash disables at 0; flash-lite floors at its documented 512", () => {
    expect(clampThinkingBudget("gemini-2.5-flash", 0)).toBe(0);
    expect(clampThinkingBudget("gemini-2.5-flash", 999_999)).toBe(24_576);
    expect(clampThinkingBudget("gemini-2.5-flash-lite", 0)).toBe(0);
    expect(clampThinkingBudget("gemini-2.5-flash-lite", 100)).toBe(512);
  });

  test("an unrecognised model gets NO thinkingConfig rather than a guessed one", () => {
    // The SDK's model union ends in `(string & {})`, so a 3.x id or a typo typechecks and only fails
    // at runtime — AFTER the turn's tokens are spent. Sending a budget whose contract we never
    // verified is the fabrication.
    expect(clampThinkingBudget("gemini-3-flash-preview", 16_384)).toBeNull();
    expect(clampThinkingBudget("gemini-flash-latest", 0)).toBeNull();
    expect(googleProviderOptions("gemini-3-flash-preview", "high").thinkingConfig).toBeUndefined();
  });
});

describe("the wire shape", () => {
  test("only `thinkingBudget` is ever sent — `thinkingLevel` is Gemini 3+ and 2.5 rejects it", () => {
    for (const intent of ["off", "low", "medium", "high", "dynamic"] as const) {
      const json = JSON.stringify(googleProviderOptions("gemini-2.5-flash", intent));
      expect(json).toContain("thinkingBudget");
      expect(json).not.toContain("thinkingLevel");
    }
  });

  test("`off` is sent explicitly as 0, not by omission", () => {
    // Omitting thinkingConfig leaves 2.5-flash thinking DYNAMICALLY (its default), so the cheap rung
    // has to say "off" out loud or it is not cheap at all.
    expect(googleProviderOptions("gemini-2.5-flash", "off")).toEqual({
      safetySettings: GOOGLE_SAFETY_SETTINGS,
      thinkingConfig: { thinkingBudget: 0 },
    });
  });
});

describe("the default model", () => {
  test("is 2.5-flash — multimodal, 1M context, reachable on a free key", () => {
    expect(GEMINI_MODEL).toBe("gemini-2.5-flash");
  });
});
