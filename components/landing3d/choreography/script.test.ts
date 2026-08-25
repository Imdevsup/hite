/**
 * script.test.ts — the honesty contract of the demo, enforced.
 *
 * The landing's tool calls are not allowed to drift from the product. Every tool name must be a
 * real planner tool that the router actually exposes for the demo prompt; every command must be a
 * real EditCommand type; every registry key must exist AND render; every number on the page must
 * come out of `deriveDemoStats()`, never a literal.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { selectToolSpecs, matchedTiers } from "@/lib/ai/tools/router";
import { TOOL_REGISTRY } from "@/lib/ai/tools/registry";
import { EditCommand } from "@/lib/edl/commands";
import { loadCatalog } from "@/lib/registry/catalog";
import { isRenderableEntry } from "@/lib/ai/tools/renderableEntry";
import {
  ACTS,
  DEMO_KEYS,
  DEMO_PROJECT,
  DEMO_PROMPT,
  SUBTITLES,
  THREAD,
  TOOL_CALLS,
  deriveDemoStats,
  formatClock,
  toolCallWindow,
} from "./script";

const PLANNER_TERMINAL = "emitEditBatch";

describe("tool calls name only real tools the router exposes for the demo prompt", () => {
  const exposed = new Set(selectToolSpecs(DEMO_PROMPT).map((s) => s.name));
  exposed.add(PLANNER_TERMINAL);

  it("routes the demo prompt to every tier the twelve calls need", () => {
    const tiers = matchedTiers(DEMO_PROMPT);
    for (const tier of ["speech", "structure", "planning", "motion", "color", "text", "rhythm"]) {
      expect(tiers, `prompt should reach the ${tier} tier`).toContain(tier);
    }
  });

  it.each(TOOL_CALLS.filter((c) => c.kind === "tool"))("$name is a real tool exposed for the prompt", (call) => {
    const isRegistered = TOOL_REGISTRY.some((s) => s.name === call.name) || call.name === PLANNER_TERMINAL;
    expect(isRegistered, `${call.name} is not in TOOL_REGISTRY`).toBe(true);
    expect(exposed.has(call.name), `${call.name} is registered but the router would not expose it for "${DEMO_PROMPT}"`).toBe(true);
  });

  it("has exactly twelve calls with distinct effects", () => {
    expect(TOOL_CALLS).toHaveLength(12);
    expect(new Set(TOOL_CALLS.map((c) => c.effect)).size).toBe(12);
    expect(new Set(TOOL_CALLS.map((c) => c.id)).size).toBe(12);
  });

  it("ends on the planner's terminal call", () => {
    expect(TOOL_CALLS[TOOL_CALLS.length - 1].name).toBe(PLANNER_TERMINAL);
  });
});

/** The `type` literal of one command variant, through the `.refine()` wrapper some of them carry. */
function typeLiteral(schema: z.ZodTypeAny): string {
  const inner = schema instanceof z.ZodEffects ? schema.innerType() : schema;
  if (!(inner instanceof z.ZodObject)) throw new Error("EditCommand variant is not an object schema");
  const literal = inner.shape.type;
  if (!(literal instanceof z.ZodLiteral)) throw new Error("EditCommand variant has no type literal");
  return String(literal.value);
}

describe("commands and keys are real", () => {
  const commandTypes = new Set(EditCommand.options.map((o) => typeLiteral(o)));

  it.each(TOOL_CALLS)("$id contributes only real EditCommand types", (call) => {
    for (const c of call.commands) expect(commandTypes.has(c), `${c} is not an EditCommand`).toBe(true);
    if (call.kind === "command") expect(commandTypes.has(call.name)).toBe(true);
  });

  it.each(Object.entries(DEMO_KEYS))("%s → %s exists in the registry and renders", async (_, key) => {
    const entries = await loadCatalog();
    const entry = entries.find((e) => e.key === key);
    expect(entry, `${key} is not in the manifest`).toBeDefined();
    if (!entry) return;
    expect(isRenderableEntry(entry), `${key} is in the manifest but withheld as unrenderable`).toBe(true);
  });

  it("names no renderer this build does not have", () => {
    const text = JSON.stringify(TOOL_CALLS) + JSON.stringify(THREAD);
    for (const banned of ["4K", "H.265", "Halide", "crossfade", "cross dissolve", "b-roll", "faces", "shot type"]) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

describe("numbers are derived, not typed", () => {
  const stats = deriveDemoStats();

  it("sums the project", () => {
    expect(stats.clipCount).toBe(DEMO_PROJECT.length);
    expect(stats.sourceSeconds).toBe(DEMO_PROJECT.reduce((s, c) => s + c.seconds, 0));
    expect(stats.silenceCount).toBe(DEMO_PROJECT.reduce((s, c) => s + c.silences.length, 0));
    expect(stats.afterRetimeSeconds).toBeLessThan(stats.afterSilenceSeconds);
    expect(stats.afterSilenceSeconds).toBeLessThan(stats.sourceSeconds);
  });

  it("puts the same numbers into the chat as the stat row", () => {
    expect(THREAD.stat).toBe(`${formatClock(stats.sourceSeconds)} → ${formatClock(stats.afterRetimeSeconds)}`);
    expect(THREAD.firstLine).toContain(String(stats.clipCount));
    expect(TOOL_CALLS.find((c) => c.id === "ripple")?.signature).toContain(String(stats.silenceCount));
    expect(TOOL_CALLS.find((c) => c.id === "export")?.signature).toContain(String(stats.commandCount));
  });

  it("says what the export really is", () => {
    expect(THREAD.exportLabel).toContain("1080p");
    expect(THREAD.exportLabel).toContain("H.264");
  });
});

describe("choreography", () => {
  it("covers 0..1 with five contiguous acts", () => {
    expect(ACTS[0].from).toBe(0);
    expect(ACTS[ACTS.length - 1].to).toBe(1);
    for (let i = 1; i < ACTS.length; i++) expect(ACTS[i].from).toBe(ACTS[i - 1].to);
  });

  it("overlaps adjacent tool calls", () => {
    for (let i = 1; i < TOOL_CALLS.length; i++) {
      const prev = toolCallWindow(i - 1);
      const next = toolCallWindow(i);
      expect(next.start).toBeLessThan(prev.end);
      expect(next.start).toBeGreaterThan(prev.start);
    }
    expect(toolCallWindow(TOOL_CALLS.length - 1).end).toBeLessThanOrEqual(0.85);
  });

  it("never shows two subtitles at once", () => {
    for (let i = 1; i < SUBTITLES.length; i++) expect(SUBTITLES[i].p - SUBTITLES[i - 1].p).toBeGreaterThan(0.055);
  });

  it("uses no em dashes in the copy (spec §15)", () => {
    const text = [THREAD.user, THREAD.firstLine, THREAD.closing, ...SUBTITLES.map((s) => s.text), ...TOOL_CALLS.flatMap((c) => [c.signature, c.commentary ?? ""])].join(" ");
    expect(text).not.toContain("—");
  });
});
