/**
 * lib/landing/hero-scene.test.ts — the gates on the hero set-piece.
 *
 * Two kinds of check live here, and they fail for different reasons.
 *
 *   · GEOMETRY. The technique is CSS 3D, which has no depth buffer and no per-pixel lighting, so it
 *     is only legal while three properties hold: seams close, depth is monotonic, and the faceting
 *     is bounded IN SCREEN SPACE. Each is measured through the six numbers the component actually
 *     emits, rebuilt with the browser's own transform algebra — not through the frame they were
 *     derived from, which would only prove the solver agrees with itself.
 *
 *   · HONESTY. The trace names tools; the lanes name registry keys; the strip prints durations. Each
 *     is checked against the running code — `selectToolSpecs` for the tools, the catalog for the
 *     keys, the generated fixture for the numbers, and the tool's own source file for the one note
 *     the scene quotes. A tool the real router would not expose for the real prompt fails the build,
 *     which is the mechanism by which beat G cannot drift into fiction.
 *
 * The module runs its own assertions at import, so a violation of the geometry contract throws
 * before any of these run. These are here to say WHICH property broke, and to catch the ones the
 * module cannot check on its own because they live in `lib/ai/**`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { selectToolSpecs } from "@/lib/ai/tools/router";
import { catalogEntry } from "@/lib/landing/catalog";
import { EXAMPLE_PROMPTS } from "@/lib/landing/prompts";
import { MECHANISM, MECHANISM_HEADLINE, MECHANISM_SOURCE } from "@/lib/landing/fixture";
import { transformAxes } from "@/lib/landing/hero-geometry";
import { HeroSetpiece } from "@/components/site/HeroSetpiece";
import { EDITOR_REACHABILITY, PRIMARY_CTA } from "@/lib/site/primaryCta";
import {
  BODY_FOOTPRINT,
  CUT_STEPS,
  FACE_RUNS,
  LANES,
  LOOK_GRADE,
  LOOK_RECIPE_STEP,
  RESULT_CUTS_PX,
  RESULT_LENGTH_PX,
  RIBBON,
  RIBBON_HEIGHT_PX,
  RIBBON_LENGTH_PX,
  RIBBON_RUNS,
  SILENCE_BANDS,
  TICKS_PER_PX,
  TRACE_ROWS,
  TYPED_CHARS,
  TYPED_SENTENCE,
  beat,
  ownCollapse,
  restingCut,
} from "@/lib/landing/hero-scene";

const HTML = renderToStaticMarkup(createElement(HeroSetpiece));
const STYLE = HTML.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "";
const VISIBLE = HTML.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");

/** The planner's terminal tool. It is not in the router's set because the planner supplies it. */
const TERMINAL_TOOL = "emitEditBatch";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   GEOMETRY — measured through the emitted transforms
   ───────────────────────────────────────────────────────────────────────────────────────── */

type V3 = readonly [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];

/** A plate corner in ribbon space, rebuilt from `--cx…--sc` exactly as the browser composes them. */
function corner(index: number, localX: number, localY: number): V3 {
  const p = RIBBON.plates[index];
  const [axisX, axisY] = transformAxes(p.ry, p.rz, p.rx);
  const slot: V3 = [p.leftPx + p.widthPx / 2, 0, 0];
  return add(add(slot, [p.cx, p.cy, p.cz]), add(mul(axisX, localX * p.sx), mul(axisY, localY)));
}

describe("the ribbon holds together", () => {
  it("closes every seam on the centre line", () => {
    for (let i = 0; i + 1 < RIBBON.plates.length; i++) {
      const a = corner(i, RIBBON.plates[i].widthPx / 2, 0);
      const b = corner(i + 1, -RIBBON.plates[i + 1].widthPx / 2, 0);
      const gap = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      expect(gap, `seam ${i}→${i + 1}`).toBeLessThan(0.5);
    }
  });

  it("recedes at every step, so painter's order is exact without a depth buffer", () => {
    for (let i = 1; i < RIBBON.plates.length; i++) {
      expect(RIBBON.plates[i].cz, `plate ${i}`).toBeLessThan(RIBBON.plates[i - 1].cz);
    }
  });

  it("bounds the facet wedge in screen px, and publishes the number", () => {
    expect(RIBBON.maxFacetGapPx).toBeLessThan(3);
    expect(RIBBON.maxFacetDeg).toBeGreaterThan(0);
  });

  it("shows face → edge → back → edge → face, with a second face long enough to read", () => {
    expect(FACE_RUNS.map((r) => r.face)).toEqual(["front", "back", "front"]);
    expect(FACE_RUNS[2].to - FACE_RUNS[2].from).toBeGreaterThanOrEqual(6);
  });

  it("keeps the plate's flat length rigid — the unroll never stretches the strip", () => {
    for (const plate of RIBBON.plates) {
      expect(plate.sx).toBeGreaterThan(0.98);
      expect(plate.sx).toBeLessThanOrEqual(1);
    }
    const spanned = RIBBON.plates.reduce((n, p) => n + p.widthPx, 0);
    expect(spanned).toBeCloseTo(RIBBON_LENGTH_PX, 6);
  });

  /**
   * THE CORRECTION SURVIVES THE TRIP TO THE DOM.
   *
   * `sx` is under 1 by a fraction of a percent, and the component's general number formatter rounds
   * to three decimals — which quantised every emitted `--sc` to exactly `1` and made
   * `scaleX(calc(1 + (var(--sc) - 1) * r))` a no-op in all 144 transforms and all eleven keyframe
   * stops. The solver computed a correction the browser never received, and every geometry test
   * above still passed, because they all read the MODULE's `sx` rather than the emitted string.
   * This is the one that reads what actually ships.
   */
  it("emits the chord correction rather than rounding it away", () => {
    const emitted = [...HTML.matchAll(/--sc:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
    expect(emitted).toHaveLength(RIBBON.plates.length);
    expect(Math.min(...emitted), "every --sc quantised to 1 — the scaleX term is a no-op").toBeLessThan(1);
    for (let i = 0; i < emitted.length; i++) {
      expect(emitted[i], `plate ${i}`).toBeCloseTo(RIBBON.plates[i].sx, 4);
    }
  });

  it("lights the object with range instead of clamping its underside flat", () => {
    const shades = RIBBON.plates.map((p) => p.shade);
    expect(Math.max(...shades) - Math.min(...shades)).toBeGreaterThan(0.4);
    // The rejected version clamped 32 of 48 plates to one value. Nothing here holds for that long.
    let longest = 1;
    let run = 1;
    for (let i = 1; i < shades.length; i++) {
      if (shades[i] === shades[i - 1]) run += 1;
      else run = 1;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThan(6);
  });

  it("gives the specular somewhere to blow out to", () => {
    expect(Math.max(...RIBBON.plates.map((p) => p.spec))).toBeGreaterThan(0.5);
  });

  it("fills the frame at every curled pose", () => {
    for (const f of BODY_FOOTPRINT) {
      expect(f.width, `beat at ${f.at}%`).toBeGreaterThan(1200);
      expect(f.coverage, `beat at ${f.at}%`).toBeGreaterThan(0.4);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE CUT — beat H on the same nodes as beat B
   ───────────────────────────────────────────────────────────────────────────────────────── */

describe("the cut is expressible on the plates that carried the curl", () => {
  it("never lets a plate straddle a run boundary", () => {
    for (const plate of RIBBON.plates) {
      const run = RIBBON_RUNS[plate.run];
      expect(plate.leftPx).toBeGreaterThanOrEqual(run.startPx - 1e-9);
      expect(plate.leftPx + plate.widthPx).toBeLessThanOrEqual(run.endPx + 1e-9);
    }
  });

  it("lands every surviving plate on its result position", () => {
    for (const plate of RIBBON.plates) {
      if (plate.removed) continue;
      const rest = restingCut(plate);
      const resultLeft = plate.leftPx + rest.tx;
      const clip = MECHANISM_HEADLINE.clips.find(
        (c) => resultLeft >= c.startTick / TICKS_PER_PX - 1e-6 && resultLeft < c.endTick / TICKS_PER_PX,
      );
      expect(clip, `plate ${plate.index} at ${resultLeft}px is inside no result clip`).toBeDefined();
    }
  });

  it("collapses every removed plate onto the seam its run leaves behind", () => {
    for (const plate of RIBBON.plates) {
      if (!plate.removed) continue;
      const rest = restingCut(plate);
      const centre = plate.leftPx + plate.widthPx / 2 + rest.tx;
      const run = RIBBON_RUNS[plate.run];
      const seam = run.startPx - (rest.tx - ownCollapse(plate)) * -1;
      expect(rest.sx).toBe(0);
      expect(centre).toBeCloseTo(seam, 6);
    }
  });

  it("removes exactly what the reducer removed", () => {
    const removedPx = RIBBON_RUNS.filter((r) => r.removed).reduce((n, r) => n + (r.endPx - r.startPx), 0);
    expect(removedPx).toBeCloseTo(MECHANISM_HEADLINE.removedTicks / TICKS_PER_PX, 6);
    expect(RIBBON_LENGTH_PX - removedPx).toBeCloseTo(RESULT_LENGTH_PX, 6);
    expect(CUT_STEPS).toHaveLength(MECHANISM_HEADLINE.removed.length);
  });

  it("puts the five cut marks where the reducer put them", () => {
    expect(RESULT_CUTS_PX).toEqual(MECHANISM_HEADLINE.cutTicks.map((t) => t / TICKS_PER_PX));
    expect(RESULT_CUTS_PX.every(Number.isInteger)).toBe(true);
  });

  it("draws the eleven pauses the analysis found, not a chosen subset", () => {
    expect(SILENCE_BANDS).toHaveLength(MECHANISM_SOURCE.silences.length);
    expect(SILENCE_BANDS.filter((b) => b.removed)).toHaveLength(MECHANISM_HEADLINE.removed.length);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   HONESTY — checked against the running code, not against this file
   ───────────────────────────────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE TWO DESKTOP EDITIONS CARRY THE SAME BEATS
   ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * §2.9.2 tables every beat of the timed edition — A→C, D, E, F's typing, G, H, I. The block that
 * implements it named six selectors while the scrubbed block named seventeen, so ~15% of visitors
 * (iOS ≤ 18.7, Firefox ≤ 156) watched the object move with none of the narrative: no typing, no
 * rake, no probe rows, no ignition, no change-diff, no lanes. Nothing LOOKED broken, because every
 * missing element rests at its final state — which is exactly why it survived review.
 *
 * A screenshot cannot catch this. The timed block only takes effect where `@supports
 * (animation-timeline: view())` FAILS, so in any browser this suite could drive, the scrubbed rules
 * are the ones that apply. The two blocks are therefore compared as text: every selector the
 * scrubbed edition animates must be animated by the timed edition too.
 */
describe("the timed edition plays the same beats as the scrubbed one", () => {
  const slice = (begin: string, end: string): string => {
    const from = STYLE.indexOf(begin);
    const to = STYLE.indexOf(end);
    expect(from, `${begin} marker missing`).toBeGreaterThan(-1);
    expect(to, `${end} marker missing`).toBeGreaterThan(from);
    return STYLE.slice(from, to);
  };

  /** Every selector in a block that is given an `animation-name`, normalised for comparison. */
  const animated = (css: string): Set<string> => {
    const names = new Set<string>();
    // Comments carry commas, so they go before the selector list is split on one.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const match of bare.matchAll(/([^{}]+)\{[^{}]*animation-name:/g)) {
      for (const selector of match[1].split(",")) {
        const cleaned = selector.replace(/\.sp\[data-play="true"\]\s*/g, "").trim();
        // `.sp-anim` is the shared carrier rule, not a beat.
        if (cleaned === "" || cleaned === ".sp-anim" || cleaned.startsWith("@")) continue;
        names.add(cleaned);
      }
    }
    return names;
  };

  it("animates every element the scrubbed edition animates", () => {
    const scrubbed = animated(slice("/* SCRUBBED-DESKTOP-BEGIN */", "/* SCRUBBED-DESKTOP-END */"));
    const timed = animated(slice("/* TIMED-DESKTOP-BEGIN */", "/* TIMED-DESKTOP-END */"));
    expect(scrubbed.size).toBeGreaterThan(12);
    const missing = [...scrubbed].filter((selector) => !timed.has(selector));
    expect(missing, `the timed edition never animates: ${missing.join(", ")}`).toEqual([]);
  });

  it("gives the pseudo-elements a timeline of their own in both editions", () => {
    // Animation properties are not inherited, so a pseudo cannot be reached by `.sp-anim` and needs
    // its own timeline (scrubbed) or its own duration (timed). Without them the browser computes
    // `animation-duration: 0s` and the animation finishes before the first frame — which is what
    // silently deleted the rake, the shade and the rails from every edition.
    const scrubbed = slice("/* SCRUBBED-DESKTOP-BEGIN */", "/* SCRUBBED-DESKTOP-END */");
    const timed = slice("/* TIMED-DESKTOP-BEGIN */", "/* TIMED-DESKTOP-END */");
    for (const rule of scrubbed.match(/[^{}]*::(before|after)[^{}]*\{[^{}]*\}/g) ?? []) {
      if (!rule.includes("animation-name")) continue;
      expect(rule, `a scrubbed pseudo rule has no timeline: ${rule.slice(0, 80)}`).toContain(
        "animation-timeline",
      );
    }
    for (const rule of timed.match(/[^{}]*::(before|after)[^{}]*\{[^{}]*\}/g) ?? []) {
      if (!rule.includes("animation-name")) continue;
      expect(rule, `a timed pseudo rule has no duration: ${rule.slice(0, 80)}`).toContain(
        "animation-duration",
      );
    }
  });
});

describe("beat G cannot drift into fiction", () => {
  const exposed = new Set(selectToolSpecs(EXAMPLE_PROMPTS[0].text).map((s) => s.name));

  it("only names tools the real router would expose for the real prompt", () => {
    for (const row of TRACE_ROWS) {
      if (row.toolName === TERMINAL_TOOL) continue;
      expect(exposed.has(row.toolName), `${row.toolName} is not routed for this prompt`).toBe(true);
    }
  });

  it("ends the turn on the planner's own terminal tool", () => {
    expect(TRACE_ROWS[TRACE_ROWS.length - 1].toolName).toBe(TERMINAL_TOOL);
    const planner = readFileSync(path.resolve(process.cwd(), "lib/ai/agents/planner.ts"), "utf8");
    expect(planner).toContain(`const EMIT_TOOL = "${TERMINAL_TOOL}"`);
  });

  /**
   * Every note is the TOOL's own string, read off the tool's own file.
   *
   * This is the assertion that stops beat G being written by a copywriter. A row with a note must
   * quote it verbatim from the module that returns it — so a re-worded tool breaks the build rather
   * than leaving the landing quoting a sentence the product no longer says.
   */
  it("quotes every empty result's note verbatim from the tool that returns it", () => {
    const noted = TRACE_ROWS.filter((r) => r.note !== null);
    expect(noted.length).toBeGreaterThan(0);
    for (const row of noted) {
      const source = readFileSync(
        path.resolve(process.cwd(), `lib/ai/tools/generated/${row.toolName}.ts`),
        "utf8",
      );
      // The tool wraps its note across source lines; compare on collapsed whitespace.
      const flat = source.replace(/\s+/g, " ");
      expect(flat, `${row.toolName} no longer returns this note`).toContain(row.note?.replace(/\s+/g, " "));
    }
  });

  /**
   * §2.3: "**Three visible refusals to fabricate are a stronger differentiator than any number of
   * green ticks**, and no competitor's marketing surface will show them."
   *
   * The inverse of the gate this replaces, which pinned "exactly one honest empty" and so held the
   * scene at three rows against a brief that asks for "many elaborate tool calls" and a spec that
   * tables five. Both halves are asserted: five rows, and three of them empty — a build that quietly
   * drops a refusal to make the demo look busier fails here.
   */
  it("shows five calls, three of them honest refusals to fabricate", () => {
    expect(TRACE_ROWS).toHaveLength(5);
    expect(TRACE_ROWS.filter((r) => !r.measured)).toHaveLength(3);
  });

  it("carries a within-beat slot for the editions the scene does not scrub", () => {
    expect(TRACE_ROWS[0].mFrom).toBe(0);
    expect(TRACE_ROWS[TRACE_ROWS.length - 1].mTo).toBe(1);
    for (const row of TRACE_ROWS) expect(row.mTo).toBeGreaterThan(row.mFrom);
  });

  it("types the one sentence that is allowlisted AND generated AND diffed", () => {
    expect(TYPED_SENTENCE).toBe(EXAMPLE_PROMPTS[0].text);
    expect(TYPED_SENTENCE).toBe(MECHANISM_HEADLINE.prompt);
    expect(MECHANISM.headlineVariantId).toBe("dead-air");
  });

  it("spends the whole typing beat and hands over to the send", () => {
    const f = beat("F");
    expect(TYPED_CHARS[0].from).toBeCloseTo(f.from, 9);
    expect(TYPED_CHARS).toHaveLength(TYPED_SENTENCE.length);
    for (let i = 1; i < TYPED_CHARS.length; i++) {
      expect(TYPED_CHARS[i].from).toBeCloseTo(TYPED_CHARS[i - 1].to, 9);
    }
  });
});

describe("beat I names nothing the renderer cannot paint", () => {
  it("uses the human phrase from the catalog, never the raw key", () => {
    for (const lane of LANES) {
      const entry = catalogEntry(lane.registryKey);
      expect(entry, lane.registryKey).toBeDefined();
      expect(lane.label).toBe(entry?.label);
      expect(VISIBLE).not.toContain(lane.registryKey);
      expect(VISIBLE).toContain(lane.label);
    }
  });

  it("renders all three of the renderer's grade layers, from a real case in the switch", () => {
    const grade = readFileSync(path.resolve(process.cwd(), "lib/remotion/fx/ColorGrade.tsx"), "utf8");
    expect(grade).toContain(`case "${LOOK_RECIPE_STEP}":`);
    expect(LOOK_GRADE.tint).toBeDefined();
    expect(LOOK_GRADE.lift).toBeGreaterThan(0);
    expect(HTML).toContain(LOOK_GRADE.filter);
    expect(HTML).toContain(LOOK_GRADE.tint?.color ?? "\0");
  });

  it("does not open the caption lane while there is no transcript to fill it", () => {
    expect(MECHANISM.asset.hasMedia).toBe(false);
    expect(HTML).not.toContain("ADD_CAPTION");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE RENDERED SCENE
   ───────────────────────────────────────────────────────────────────────────────────────── */

describe("what the server paints", () => {
  it("paints the H1 at full opacity, unsplit, and not behind JavaScript", () => {
    expect(HTML).toContain("Describe the edit. A real timeline cuts it.");
    expect(HTML).not.toMatch(/<h1[^>]*opacity/);
    expect(STYLE).not.toMatch(/\.t-hero[^}]*opacity/);
  });

  it("paints the finished edit as the resting state", () => {
    expect(VISIBLE).toContain(MECHANISM_HEADLINE.timecode);
    expect(VISIBLE).toContain(MECHANISM_SOURCE.timecode);
    expect(VISIBLE).toContain(MECHANISM_HEADLINE.removedTimecode);
    expect(HTML).toContain("SPLIT_CLIP");
    expect(HTML).toContain("REMOVE_CLIP");
  });

  it("renders one plate per solved plate, and no more", () => {
    expect(HTML.match(/class="sp-plate/g) ?? []).toHaveLength(RIBBON.plates.length);
  });

  it("puts the skip control before anything else focusable in the section", () => {
    const skip = HTML.indexOf("skip-inline");
    const firstLink = HTML.indexOf("<a ");
    expect(skip).toBeGreaterThan(-1);
    expect(HTML.slice(firstLink, skip + 20)).toContain("skip-inline");
  });

  it("authors every animation inside prefers-reduced-motion: no-preference", () => {
    const blocks = STYLE.split(/@media[^{]*\(prefers-reduced-motion: no-preference\)/);
    // The head of the split is everything OUTSIDE a no-preference block.
    expect(blocks[0]).not.toMatch(/\banimation-name\s*:/);
    expect(blocks[0]).not.toMatch(/\banimation\s*:\s*sp-/);
  });

  it("keeps clip-path, blur and backdrop-filter out of the scene", () => {
    // Blink does not composite clip-path; a scroll-driven clip animation would put the payoff beat
    // back on the main thread. `filter: blur()` and `backdrop-filter` are banned in the LCP viewport.
    expect(STYLE).not.toContain("clip-path");
    expect(STYLE).not.toContain("backdrop-filter");
    expect(STYLE).not.toMatch(/filter:\s*blur\(/);
    expect(HTML).not.toMatch(/filter:\s*blur\(/);
  });

  it("never puts a flattening property on the three elements that carry the 3D context", () => {
    for (const selector of [".sp-scene", ".sp-ribbon", ".sp-plate"]) {
      const rules = [...STYLE.matchAll(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, "g"))];
      for (const rule of rules) {
        expect(rule[1], selector).not.toMatch(/overflow\s*:|clip-path|mask-image|mix-blend-mode|contain\s*:\s*paint/);
      }
    }
  });

  it("draws the silence bands at --line-4, the rung the direction assigns them", () => {
    expect(STYLE).toContain("var(--line-4)");
  });

  it("carries no fabricated claim and no banned phrase", () => {
    const banned = ["to the pixel", "in seconds", "in minutes", "beat sync", "beat-sync", "$", "per month"];
    const lower = VISIBLE.toLowerCase();
    for (const phrase of banned) expect(lower, phrase).not.toContain(phrase);
    expect((lower.match(/\bbeta\b/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it("says the picture is not shipped, before anyone has to notice", () => {
    expect(VISIBLE).toContain("the picture is not shipped");
  });

  /**
   * §3.1's CTA — pointing wherever the editor actually is for the build under test.
   *
   * THIS ASSERTION HAS NOW BEEN WRITTEN BOTH WAYS AND BOTH WERE WRONG, which is the tell that it was
   * never a copy question. It first pinned "converts to a clone-and-run, never to a hosted editor";
   * that was inverted to "must say Open the editor and link /app" on the evidence that the tree ships
   * `app/app/page.tsx`. Each side cited a real fact and each shipped a false claim in the other
   * deployment, because the hero's CTA is a promise about a DEPLOYMENT and both gates hard-coded one.
   *
   * The invariant that survives both is the one asserted here: the hero converts to the SAME place the
   * rest of the page converts to (`PRIMARY_CTA`, so the hero can never contradict the nav and the
   * final CTA again — the failure the previous comment correctly named), and that place has to exist
   * in the deployment being built. The landing-only case gets its own test below, because that is the
   * direction that ships a lie to the whole internet rather than a redundancy to one developer.
   */
  it("converts to the same place the rest of the page does, in §3.1's words", () => {
    expect(HTML).toContain(`href="${PRIMARY_CTA.href}"`);
    expect(HTML).toContain(PRIMARY_CTA.label);
    // The second link is the source, and it is the only outbound one in the hero.
    expect(HTML).toContain("Read the code");
  });

  it("never offers a hosted editor on a landing-only build", () => {
    // The default under test IS the landing-only build (`NEXT_PUBLIC_HITE_EDITOR` is unset here, and
    // `primaryCta.ts` fails safe to `hosted-landing`), so this runs against the deployed shape.
    expect(EDITOR_REACHABILITY).toBe("hosted-landing");
    expect(HTML).not.toContain('href="/app"');
    expect(VISIBLE).not.toContain("Open the editor");
  });

  it("keeps the visible word count under the direction's hero cap", () => {
    const copy = [
      "Describe the edit. A real timeline cuts it.",
      "Free to start · no sign-up · no card",
      PRIMARY_CTA.label,
      "Read the code",
    ]
      .join(" ")
      .split(/[\s·]+/)
      .filter((w) => /[a-z]/i.test(w));
    expect(copy.length).toBeLessThanOrEqual(24);
  });
});

describe("the ribbon's height and scale stay derived", () => {
  it("is exactly two stage widths long and resolves to the page's measure", () => {
    expect(RIBBON_LENGTH_PX).toBe(2880);
    expect(TICKS_PER_PX).toBe(500);
    expect(MECHANISM_SOURCE.durationTicks / TICKS_PER_PX).toBe(RIBBON_LENGTH_PX);
    expect(RIBBON_HEIGHT_PX).toBe(128);
  });
});
