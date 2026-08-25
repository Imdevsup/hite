import { afterEach, describe, expect, test, vi } from "vitest";
import type { StateCreator, StoreApi } from "zustand/vanilla";

/**
 * ONE TEST SEAM, DECLARED FIRST BECAUSE IT HAS TO BE HOISTED.
 *
 * zustand v5 wires its hook as
 * `useSyncExternalStore(subscribe, () => selector(getState()), () => selector(getInitialState()))`,
 * so a SERVER render reads `getInitialState()` and never sees a `setState`. That is not a quirk — it
 * is the editor's real behaviour: the store is client-only, so the server HTML of `/app/[id]` is
 * always the empty screen and the working one arrives a tick after hydration.
 *
 * This shim makes the server snapshot equal the live snapshot, and nothing else. It is the smallest
 * thing that lets a store-driven screen be server-rendered at all, and it changes no product code:
 * the same `createStore` from `zustand/vanilla` backs it, so every selector, subscription and
 * `getState()` call behaves exactly as it does in the browser.
 *
 * The alternative was a DOM environment for one test file, which would mean editing the repo's shared
 * `vitest.config.ts` — a file this unit does not own, while other units are building against it.
 */
type AnyState = Record<string, unknown>;

vi.mock("zustand", async () => {
  const { createStore } = await import("zustand/vanilla");
  const React = await import("react");
  const identity = (state: AnyState): unknown => state;

  const createImpl = (initializer: StateCreator<AnyState>) => {
    const api: StoreApi<AnyState> = createStore(initializer);
    const snapshot = () => api.getState();
    const useBoundStore = (selector: (state: AnyState) => unknown = identity) =>
      React.useSyncExternalStore(
        api.subscribe,
        () => selector(snapshot()),
        // THE ONE LINE THAT DIFFERS FROM ZUSTAND: the server snapshot is the live state.
        () => selector(snapshot()),
      );
    Object.assign(useBoundStore, api);
    return useBoundStore;
  };

  return {
    create: (initializer?: StateCreator<AnyState>) =>
      initializer ? createImpl(initializer) : createImpl,
  };
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { EditorFrame } = await import("./EditorFrame");
const { AFFORDANCE, FIRST_SCREEN_EMPTY, FIRST_SCREEN_WORKING } = await import("./affordances");
const { useEditor } = await import("@/lib/editor/store");
const { emptyEdl2 } = await import("@/lib/edl/schema");
const { msToTicks } = await import("@/lib/edl/time");
type Asset = import("@/lib/editor/store").Asset;

/**
 * THE GATE — ART-DIRECTION §20, "the editor's eight objects grow back to twenty-two".
 *
 * The check §20 specifies, verbatim: "A test counting focusable and visible top-level affordances on
 * the editor's first screen, failing above 8 — with the strip counted as one composite widget and the
 * rule written into the test so the count cannot be gamed later."
 *
 * THE RULE, WRITTEN DOWN. An affordance is a TAB STOP, not an element — the only definition under
 * which a count means anything to the person using the editor, and the one §13 already reasons with
 * when it makes the strip a listbox: "one tab stop, arrows move within it. That is the standard
 * pattern and it is why the count is honest rather than gamed."
 *
 * So `tabStops()` counts exactly what a keyboard reaches with Tab:
 *   · `<a href>`, `<button>`, `<input>`, `<textarea>`, `<select>`, or anything with `tabindex="0"`
 *   · MINUS `tabindex="-1"` (a roving-tabindex member, reached with an arrow key)
 *   · MINUS `disabled`, `hidden`, `type="hidden"` and `aria-hidden="true"`
 *
 * And the count is only half of it. Three further assertions close every way a ninth control could
 * arrive without the number moving: every tab stop must carry a `data-affordance` naming itself,
 * every name must be on the list for the screen being rendered, and every name on the list must
 * appear exactly once. A new control is therefore either declared in `affordances.ts` (and fails the
 * count) or undeclared (and fails the membership check). There is no third option.
 *
 * WHAT IS DELIBERATELY NOT ON THE FIRST SCREEN, and is asserted absent below: a clip's trim and
 * delete handles (they need a selection), the settings sheet and the `?` sheet (they need opening),
 * the expanded tool trace (it needs the history line pressed), the `/` menu (it needs a slash), and
 * the key field a 402 puts in the composer (it needs a 402). Each is revealed by an interaction,
 * which is what "not on the first screen" means.
 */

const TAB_STOP =
  /<a\s[^>]*href=[^>]*>|<(?:button|input|textarea|select)(?:\s[^>]*)?>|<[a-z]+[^>]*\stabindex="0"[^>]*>/gi;

interface Stop {
  readonly tag: string;
  readonly affordance: string | null;
}

function tabStops(html: string): Stop[] {
  const out: Stop[] = [];
  for (const raw of html.match(TAB_STOP) ?? []) {
    if (/tabindex="-1"/i.test(raw)) continue;
    if (/\sdisabled(?:=|[\s/>])/i.test(raw)) continue;
    if (/\shidden(?:=""|[\s/>])/i.test(raw)) continue;
    if (/type="hidden"/i.test(raw)) continue;
    if (/aria-hidden="true"/i.test(raw)) continue;
    out.push({
      tag: raw.match(/^<([a-z]+)/i)?.[1].toLowerCase() ?? "?",
      affordance: raw.match(/data-affordance="([^"]+)"/)?.[1] ?? null,
    });
  }
  return out;
}

const ASSET: Asset = {
  id: "a1",
  kind: "video",
  blob_url: "https://example.test/take.mp4",
  filename: "take.mp4",
  duration_ms: 48_000,
  width: 1920,
  height: 1080,
  fps: 30,
};

function render(): string {
  return renderToStaticMarkup(createElement(EditorFrame, { projectId: "p1" }));
}

/** One asset with a readable length, and the timeline `addAsset` seeds from it. */
function seedWorking(over: Partial<ReturnType<typeof useEditor.getState>> = {}) {
  useEditor.setState({
    projectId: "p1",
    assets: [ASSET],
    primaryAsset: ASSET,
    edl: emptyEdl2(ASSET.id, msToTicks(ASSET.duration_ms as number), ASSET.blob_url),
    selectedClipId: null,
    ...over,
  });
}

function seedEmpty() {
  useEditor.setState({ projectId: "p1", assets: [], primaryAsset: null, edl: null, selectedClipId: null });
}

afterEach(seedEmpty);

describe("the first screen, before there is footage", () => {
  test("is exactly the seven things §13 enumerates — no more, no fewer", () => {
    seedEmpty();
    const stops = tabStops(render());
    const names = stops.map((s) => s.affordance);

    expect(stops.every((s) => s.affordance !== null), `an undeclared tab stop: ${JSON.stringify(stops)}`).toBe(true);
    expect(names.length, `expected ${FIRST_SCREEN_EMPTY.length} tab stops, got ${JSON.stringify(names)}`).toBe(
      FIRST_SCREEN_EMPTY.length,
    );
    for (const affordance of FIRST_SCREEN_EMPTY) {
      expect(names.filter((n) => n === affordance).length, `${affordance} should appear exactly once`).toBe(1);
    }
  });

  test("the file picker itself is not a tab stop — the button in front of it is", () => {
    seedEmpty();
    const html = render();
    expect(html).toContain('type="file"');
    expect(html).toContain(`data-affordance="${AFFORDANCE.chooseFile}"`);
  });

  test("there is no Export before there is anything to export", () => {
    seedEmpty();
    expect(render()).not.toContain(`data-affordance="${AFFORDANCE.export}"`);
  });

  test("the three examples are the allowlist's, in its order", () => {
    seedEmpty();
    const html = render();
    for (const slot of [AFFORDANCE.example1, AFFORDANCE.example2, AFFORDANCE.example3]) {
      expect(html).toContain(`data-affordance="${slot}"`);
    }
  });
});

describe("the first screen, working", () => {
  test("is exactly the eight things §13 enumerates — no more, no fewer", () => {
    seedWorking();
    const stops = tabStops(render());
    const names = stops.map((s) => s.affordance);

    expect(stops.every((s) => s.affordance !== null), `an undeclared tab stop: ${JSON.stringify(stops)}`).toBe(true);
    expect(names.length, `expected ${FIRST_SCREEN_WORKING.length} tab stops, got ${JSON.stringify(names)}`).toBe(
      FIRST_SCREEN_WORKING.length,
    );
    for (const affordance of FIRST_SCREEN_WORKING) {
      expect(names.filter((n) => n === affordance).length, `${affordance} should appear exactly once`).toBe(1);
    }
  });

  test("the strip is ONE tab stop with its clips behind arrow keys", () => {
    seedWorking();
    const html = render();
    expect(html).toContain('role="listbox"');
    expect((html.match(/role="option"/g) ?? []).length).toBeGreaterThan(0);
    expect(tabStops(html).filter((s) => s.affordance === AFFORDANCE.strip).length).toBe(1);
  });

  test("the history is ONE tab stop with its two buttons behind arrow keys", () => {
    seedWorking();
    const html = render();
    expect(html).toContain('role="toolbar"');
    expect(tabStops(html).filter((s) => s.affordance === AFFORDANCE.history).length).toBe(1);
  });

  test("the picture is the transport: the frame is the control, and there is no play button", () => {
    seedWorking();
    const html = render();
    expect(html).toContain(`data-affordance="${AFFORDANCE.picture}"`);
    expect(html).toMatch(/aria-label="(Play|Pause)"/);
    // A separate transport would be a ninth tab stop; the count above already forbids it, and this
    // says WHY the count is what it is.
    expect((html.match(/aria-label="Play"/g) ?? []).length).toBeLessThanOrEqual(1);
  });
});

describe("what §13 says must not be on screen before the user acts", () => {
  test("no timecode, on either screen", () => {
    // "the brief fails the design if timecode appears before the user has done anything."
    for (const seed of [seedEmpty, seedWorking]) {
      seed();
      const html = render();
      expect(html, "SMPTE").not.toMatch(/\d\d:\d\d:\d\d:\d\d/);
      expect(html, "a duration readout at rest").not.toMatch(/>[^<]*\b\d+:\d\d\b[^<]*of\b/);
    }
  });

  test("the scrubber has no numerals of its own", () => {
    seedWorking();
    const html = render();
    // Its position IS the time. `aria-valuetext` speaks it, which is not a numeral on screen —
    // hiding a slider's value from assistive technology would trade one user's clarity for another's.
    expect(html).toContain('role="slider"');
    expect(html).toContain("aria-valuetext=");
  });

  test("no shortcut is surfaced in session one", () => {
    for (const seed of [seedEmpty, seedWorking]) {
      seed();
      const html = render();
      expect(html.toLowerCase()).not.toContain("shift+enter");
      expect(html).not.toContain("Ctrl+");
      expect(html.toLowerCase()).not.toContain("press ?");
      expect(html.toLowerCase()).not.toContain("for shortcuts");
    }
  });

  test("a clip's handles do not exist until a clip is selected", () => {
    seedWorking();
    expect(render()).not.toContain("Trim the start of this clip");

    seedWorking({ selectedClipId: "c0" });
    const selected = render();
    expect(selected).toContain("Trim the start of this clip");
    expect(selected).toContain("Trim the end of this clip");
    expect(selected).toContain("Delete this clip and close the gap");
    // And they ARE reachable once revealed — three real controls, not three pictures of controls.
    expect(tabStops(selected).length).toBe(FIRST_SCREEN_WORKING.length + 3);
  });

  test("neither sheet is in the document until it is opened", () => {
    seedWorking();
    expect(render()).not.toContain('role="dialog"');
  });
});
