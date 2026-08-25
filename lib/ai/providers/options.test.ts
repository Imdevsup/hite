import { describe, expect, test } from "vitest";
import { EFFORT, EFFORT_LEVELS } from "@/lib/ai/effort";
import { PARALLEL_TOOL_CALL_OPTION, PROVIDER_OPTION_NAMESPACE, wireOptionsFor } from "./options";
import { PROVIDERS } from "./registry";
import type { ModelSelection, ProviderId, ThinkingIntent } from "./types";

/**
 * The per-provider wire shapes. Eight vendors spell the same lever eight ways, and a table with no
 * test is a table where one entry quietly stops being sent.
 *
 * Every expected value below was read from the INSTALLED package's shipped provider-options schema,
 * not from memory. If one of these fails after a dependency bump, the vendor changed their enum and
 * the fix is to re-read `dist/index.d.ts` — never to loosen the assertion.
 */

const sel = (providerId: ProviderId, model: string, extra: Partial<ModelSelection> = {}): ModelSelection => ({
  providerId,
  model,
  surface: null,
  baseUrl: null,
  ...extra,
});

describe("google keeps everything that was Gemini-specific", () => {
  test("BLOCK_NONE survives at every rung — creative edit prompts get refused without it", () => {
    for (const level of EFFORT_LEVELS) {
      const wire = wireOptionsFor(sel("google", "gemini-2.5-flash"), EFFORT[level].thinking);
      expect(JSON.stringify(wire), level).toContain("BLOCK_NONE");
    }
  });

  test("the ladder's Gemini budgets are numerically what they always were", () => {
    const budget = (intent: ThinkingIntent) =>
      (wireOptionsFor(sel("google", "gemini-2.5-flash"), intent).google as { thinkingConfig?: { thinkingBudget: number } })
        .thinkingConfig?.thinkingBudget;
    expect(budget("off")).toBe(0); // NOT absent: flash thinks dynamically when unset
    expect(budget("low")).toBe(4096);
    expect(budget("high")).toBe(16_384);
    expect(budget("dynamic")).toBe(-1);
  });

  test("`thinkingLevel` is NEVER sent — it is a Gemini 3+ field the 2.5 series rejects", () => {
    for (const intent of ["off", "low", "medium", "high", "dynamic"] as const) {
      expect(JSON.stringify(wireOptionsFor(sel("google", "gemini-2.5-flash"), intent))).not.toContain("thinkingLevel");
    }
  });

  test("an unrecognised Gemini id gets safety settings and NO guessed budget", () => {
    const wire = wireOptionsFor(sel("google", "gemini-9-flash-preview"), "high").google as Record<string, unknown>;
    expect(wire.safetySettings).toBeDefined();
    expect(wire.thinkingConfig).toBeUndefined();
  });

  test("2.5-pro is never handed 0 — it cannot disable thinking, and 0 is a 400 after the spend", () => {
    const wire = wireOptionsFor(sel("google", "gemini-2.5-pro"), "off").google as {
      thinkingConfig: { thinkingBudget: number };
    };
    expect(wire.thinkingConfig.thinkingBudget).toBe(128);
  });
});

describe("each provider gets its OWN spelling, under its OWN namespace", () => {
  test("openai — reasoningEffort, from the none|minimal|low|medium|high|xhigh|max enum", () => {
    expect(wireOptionsFor(sel("openai", "gpt-5.4-mini"), "off")).toEqual({ openai: { reasoningEffort: "none" } });
    expect(wireOptionsFor(sel("openai", "gpt-5.4-mini"), "high")).toEqual({ openai: { reasoningEffort: "high" } });
    expect(wireOptionsFor(sel("openai", "gpt-5.4-mini"), "dynamic")).toEqual({ openai: { reasoningEffort: "max" } });
  });

  test("groq — `default` is their literal 'you decide', which is what `dynamic` means", () => {
    expect(wireOptionsFor(sel("groq", "qwen/qwen3-32b"), "dynamic")).toEqual({ groq: { reasoningEffort: "default" } });
    expect(wireOptionsFor(sel("groq", "qwen/qwen3-32b"), "off")).toEqual({ groq: { reasoningEffort: "none" } });
  });

  test("xai — the enum tops out at xhigh, so that is where `dynamic` lands", () => {
    expect(wireOptionsFor(sel("xai", "grok-4.6"), "dynamic")).toEqual({ xai: { reasoningEffort: "xhigh" } });
    expect(wireOptionsFor(sel("xai", "grok-4.6"), "medium")).toEqual({ xai: { reasoningEffort: "medium" } });
  });

  test("anthropic — `thinking` and `effort` are two different knobs", () => {
    expect(wireOptionsFor(sel("anthropic", "claude-sonnet-5"), "off")).toEqual({
      anthropic: { thinking: { type: "disabled" } },
    });
    expect(wireOptionsFor(sel("anthropic", "claude-sonnet-5"), "dynamic")).toEqual({
      anthropic: { thinking: { type: "adaptive" } },
    });
    expect(wireOptionsFor(sel("anthropic", "claude-sonnet-5"), "high")).toEqual({ anthropic: { effort: "high" } });
  });

  test("deepseek — thinking must be enabled for reasoningEffort to mean anything", () => {
    expect(wireOptionsFor(sel("deepseek", "deepseek-reasoner"), "low")).toEqual({
      deepseek: { thinking: { type: "enabled" }, reasoningEffort: "low" },
    });
    expect(wireOptionsFor(sel("deepseek", "deepseek-chat"), "off")).toEqual({
      deepseek: { thinking: { type: "disabled" } },
    });
  });

  test("openrouter — the lever is nested under `reasoning`", () => {
    expect(wireOptionsFor(sel("openrouter", "openai/gpt-5.4-mini"), "high")).toEqual({
      openrouter: { reasoning: { effort: "high" } },
    });
  });

  test("local — no lever exists, so NOTHING is sent rather than a guess", () => {
    // C7: the rung still runs; the settings UI reports the lever as unavailable rather than
    // implying it is working.
    for (const level of EFFORT_LEVELS) {
      expect(wireOptionsFor(sel("local", "qwen3:8b", { baseUrl: "http://localhost:11434/v1" }), EFFORT[level].thinking))
        .toEqual({});
    }
  });

  test("no provider's options ever leak into another provider's namespace", () => {
    for (const entry of PROVIDERS) {
      for (const level of EFFORT_LEVELS) {
        const wire = wireOptionsFor(sel(entry.id, entry.models[0]?.id ?? "x", { baseUrl: "http://localhost:1/v1" }), EFFORT[level].thinking);
        for (const key of Object.keys(wire)) {
          expect(key, `${entry.id} at ${level}`).toBe(PROVIDER_OPTION_NAMESPACE[entry.id]);
        }
      }
    }
  });

  test("BLOCK_NONE is Google's alone and is never sent to anyone else", () => {
    for (const entry of PROVIDERS) {
      if (entry.id === "google") continue;
      for (const level of EFFORT_LEVELS) {
        const json = JSON.stringify(
          wireOptionsFor(sel(entry.id, entry.models[0]?.id ?? "x", { baseUrl: "http://localhost:1/v1" }), EFFORT[level].thinking),
        );
        expect(json, entry.id).not.toContain("safetySettings");
      }
    }
  });
});

describe("parallel tool calls are recorded but deliberately NOT disabled", () => {
  test("nothing in the emitted options touches the parallel switch", () => {
    // The grounding phase depends on parallel calls to reach 4-6 analysis calls in 2 steps. Turning
    // them off pre-emptively would make high/max slower and shallower to prevent a failure nobody has
    // measured; the harness grades `contractViolations` instead, and THEN this table is the fix.
    for (const entry of PROVIDERS) {
      const option = PARALLEL_TOOL_CALL_OPTION[entry.id];
      if (!option) continue;
      for (const level of EFFORT_LEVELS) {
        const json = JSON.stringify(
          wireOptionsFor(sel(entry.id, entry.models[0]?.id ?? "x", { baseUrl: "http://localhost:1/v1" }), EFFORT[level].thinking),
        );
        expect(json, `${entry.id}.${option.key}`).not.toContain(option.key);
      }
    }
  });

  test("the two traps are written down with their exact spelling", () => {
    // Anthropic's is INVERTED and xAI's is snake_case. Getting either wrong is a silent no-op.
    expect(PARALLEL_TOOL_CALL_OPTION.anthropic).toEqual({ key: "disableParallelToolUse", disableValue: true });
    expect(PARALLEL_TOOL_CALL_OPTION.xai).toEqual({ key: "parallel_function_calling", disableValue: false });
    expect(PARALLEL_TOOL_CALL_OPTION.google).toBeNull(); // Google exposes no switch at all
  });
});
