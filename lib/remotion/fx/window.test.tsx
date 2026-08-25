import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentType } from "react";
import { withinWindow } from "./window";
import type { EffectRendererProps } from "../registry";
import { ChromaticAberration } from "./ChromaticAberration";
import { RgbSplit } from "./RgbSplit";
import { GlitchBars } from "./GlitchBars";
import { Vignette } from "./Vignette";
import { FilmGrain } from "./FilmGrain";
import { ZoomPunch } from "./ZoomPunch";
import { ColorGrade } from "./ColorGrade";

/**
 * Every fx renderer must honour the effect's enable window. Before this, ONLY ZoomPunch did — so
 * `chromatic-flash`, a momentary hit by name, painted the whole clip, and a 50 ms windowed flash was
 * a permanent one in preview AND export.
 *
 * These render the real components (they are pure CSS wrappers taking `frame` as a prop, no Remotion
 * context needed) and compare the markup outside the window against the bare child: pass-through
 * means the child comes back untouched, which is the only definition that cannot be faked by a
 * near-zero-strength wrapper.
 */

const CHILD = <span id="clip" />;
const BARE = renderToStaticMarkup(CHILD);

/** effectKey → renderer, mirroring lib/remotion/registry.tsx's registrations. */
const RENDERERS: [string, ComponentType<EffectRendererProps>, Record<string, unknown>][] = [
  ["chromatic-flash", ChromaticAberration, { strength: 10 }],
  ["rgb-split-hard", RgbSplit, { strength: 0.9 }],
  ["glitch-bars", GlitchBars, { density: 0.4 }],
  ["vignette-soft", Vignette, { strength: 0.5 }],
  ["grain-fine-medium", FilmGrain, { intensity: 0.2 }],
  ["zoom-punch", ZoomPunch, { amount: 1.15 }],
  ["lut-vhs-worn", (p: EffectRendererProps) => <ColorGrade {...p} effectKey="lut-vhs-worn" />, {}],
];

function render(R: ComponentType<EffectRendererProps>, params: Record<string, unknown>, frame: number): string {
  return renderToStaticMarkup(
    <R params={params} frame={frame} startFrame={100} endFrame={110}>
      {CHILD}
    </R>,
  );
}

describe("withinWindow", () => {
  test("half-open [start, end) — the same convention as a TickWindow", () => {
    expect(withinWindow(99, 100, 110)).toBe(false);
    expect(withinWindow(100, 100, 110)).toBe(true);
    expect(withinWindow(109, 100, 110)).toBe(true);
    expect(withinWindow(110, 100, 110)).toBe(false);
  });

  test("an undefined bound is open on that side (whole-clip effects)", () => {
    expect(withinWindow(0, undefined, undefined)).toBe(true);
    expect(withinWindow(1e6, undefined, undefined)).toBe(true);
    expect(withinWindow(5, 10, undefined)).toBe(false);
    expect(withinWindow(50, 10, undefined)).toBe(true);
    expect(withinWindow(50, undefined, 10)).toBe(false);
  });
});

describe("every registered renderer gates on its window", () => {
  test.each(RENDERERS)("%s passes the clip through untouched outside [100, 110)", (_key, R, params) => {
    expect(render(R, params, 0)).toBe(BARE); // before
    expect(render(R, params, 99)).toBe(BARE); // last frame before
    expect(render(R, params, 110)).toBe(BARE); // first frame after (half-open)
    expect(render(R, params, 500)).toBe(BARE); // long after
  });

  test.each(RENDERERS)("%s DOES paint inside the window", (_key, R, params) => {
    const inside = render(R, params, 104);
    expect(inside).not.toBe(BARE);
    expect(inside).toContain('id="clip"'); // still wraps the clip, never replaces it
  });

  test.each(RENDERERS)("%s with no window at all paints everywhere (whole-clip effect)", (_key, R, params) => {
    const markup = renderToStaticMarkup(
      <R params={params} frame={9999}>
        {CHILD}
      </R>,
    );
    expect(markup).not.toBe(BARE);
  });
});

describe("chromatic-flash is momentary again (the named regression)", () => {
  test("a 2-frame flash paints 2 frames, not the whole clip", () => {
    const painted = [];
    for (let f = 0; f < 20; f++) {
      const markup = renderToStaticMarkup(
        <ChromaticAberration params={{ strength: 10 }} frame={f} startFrame={10} endFrame={12}>
          {CHILD}
        </ChromaticAberration>,
      );
      if (markup !== BARE) painted.push(f);
    }
    expect(painted).toEqual([10, 11]);
  });
});
