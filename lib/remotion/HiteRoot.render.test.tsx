import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

/**
 * ClipFx / CaptionView rendered for real.
 *
 * Remotion's media primitives need a render context (`<Img>` calls delayRender, `<OffthreadVideo>`
 * wants the SharedAudioContext), so they cannot be mounted in the node test env. We stub ONLY those
 * primitives — thin host elements that record the props HiteRoot passes — because what is under test
 * is HITE's branching, not Remotion's players. Everything else (the effect loop, the window rebase,
 * the word highlighting) is the real code.
 */
let currentFrame = 0;
vi.mock("remotion", () => ({
  AbsoluteFill: ({ children, style }: { children?: ReactNode; style?: object }) => <div data-fill="1" style={style}>{children}</div>,
  Sequence: ({ children }: { children?: ReactNode }) => <div data-seq="1">{children}</div>,
  Img: (props: Record<string, unknown>) => <img data-remotion="img" src={String(props.src)} alt="" />,
  OffthreadVideo: (props: Record<string, unknown>) => (
    <video data-remotion="video" src={String(props.src)} data-trim-before={String(props.trimBefore)} data-trim-after={String(props.trimAfter)} data-rate={String(props.playbackRate)} />
  ),
  Audio: (props: Record<string, unknown>) => <audio data-remotion="audio" src={String(props.src)} />,
  useCurrentFrame: () => currentFrame,
  interpolate: (n: number) => n,
}));

const { ClipFx, CaptionView, OverlayView } = await import("./HiteRoot");
type ClipNode = Parameters<typeof ClipFx>[0]["node"];
type CaptionNode = Parameters<typeof CaptionView>[0]["node"];

function clip(overrides: Partial<ClipNode> = {}): ClipNode {
  return {
    kind: "clip",
    id: "c0",
    hash: "",
    source: { assetId: "a", url: "https://blob/a.mp4", refKey: "full", mediaKind: "video" },
    startTick: 0,
    endTick: 120_000,
    startFrame: 0,
    endFrame: 120,
    inTick: 0,
    outTick: 120_000,
    inFrame: 0,
    outFrame: 120,
    playback: { kind: "static", rate: 1 },
    volume: { kind: "static", gain: 1 },
    effects: [],
    ...overrides,
  };
}

describe("a still on the timeline renders as an image, never as a video", () => {
  test("mediaKind 'image' → <Img>, with no video-only trim/rate props", () => {
    // OffthreadVideo pointed at a PNG breaks the preview frame and CRASHES renderMedia on export
    // minutes into a render — and ClipNode had no media-kind field at all until now.
    const html = renderToStaticMarkup(<ClipFx node={clip({ source: { assetId: "a", url: "https://blob/logo.png", refKey: "full", mediaKind: "image" } })} />);
    expect(html).toContain('data-remotion="img"');
    expect(html).toContain("https://blob/logo.png");
    expect(html).not.toContain('data-remotion="video"');
    expect(html).not.toContain("data-trim-before");
  });

  test("mediaKind 'video' still goes through OffthreadVideo with its source range", () => {
    const html = renderToStaticMarkup(<ClipFx node={clip({ inFrame: 30, outFrame: 90 })} />);
    expect(html).toContain('data-remotion="video"');
    expect(html).toContain('data-trim-before="30"');
    expect(html).toContain('data-trim-after="90"');
  });
});

describe("clip effects are wrapped only inside their window", () => {
  const windowed = clip({
    startFrame: 300, // the clip starts 10s into the timeline
    endFrame: 420,
    effects: [
      // ABSOLUTE window [330, 336) → clip-relative [30, 36)
      { kind: "effect", id: "fx1", hash: "", effectKey: "chromatic-flash", engine: "remotion", params: { strength: 10 }, window: { startFrame: 330, endFrame: 336 } },
    ],
  });

  test("outside the window the clip is untouched", () => {
    currentFrame = 0;
    const outside = renderToStaticMarkup(<ClipFx node={windowed} />);
    currentFrame = 31; // clip-relative, inside [30, 36)
    const inside = renderToStaticMarkup(<ClipFx node={windowed} />);
    expect(outside).not.toContain("drop-shadow");
    expect(inside).toContain("drop-shadow");
    currentFrame = 0;
  });

  test("an effect with no registered renderer is skipped (it must not blow up the clip)", () => {
    currentFrame = 0;
    const html = renderToStaticMarkup(
      <ClipFx node={clip({ effects: [{ kind: "effect", id: "fx1", hash: "", effectKey: "audio-saturation-soft", engine: "remotion", params: {} }] })} />,
    );
    expect(html).toContain('data-remotion="video"');
  });
});

describe("captions render their per-word timings (karaoke is not just a font)", () => {
  function caption(): CaptionNode {
    return {
      kind: "caption",
      id: "cap0",
      hash: "",
      window: { startFrame: 100, endFrame: 160 },
      text: "cut to the beat",
      style: "karaoke",
      fontHash: "",
      words: [
        { text: "cut", startFrame: 100, endFrame: 110 },
        { text: "to", startFrame: 110, endFrame: 120 },
        { text: "the", startFrame: 120, endFrame: 130 },
        { text: "beat", startFrame: 130, endFrame: 160 },
      ],
    };
  }

  test("exactly one word is highlighted, and it advances with the frame", () => {
    // CaptionView sits in a <Sequence from={window.startFrame}>, so useCurrentFrame() is
    // window-relative — frame 15 here means absolute frame 115, i.e. the second word.
    currentFrame = 15;
    const html = renderToStaticMarkup(<CaptionView node={caption()} />);
    const highlighted = [...html.matchAll(/color:#FFFFFF[^>]*>([^<]*)</g)].map((m) => m[1].trim());
    expect(highlighted).toEqual(["to"]);
    // Spoken words stay lit, upcoming ones are dimmed — that contrast IS the read-along.
    expect(html).toContain("opacity:0.45");
    expect(html).toContain("the");
    expect(html).toContain("beat");

    currentFrame = 35; // absolute 135 → "beat"
    const later = renderToStaticMarkup(<CaptionView node={caption()} />);
    expect([...later.matchAll(/color:#FFFFFF[^>]*>([^<]*)</g)].map((m) => m[1].trim())).toEqual(["beat"]);
    currentFrame = 0;
  });

  test("a caption without word timings still renders its full text", () => {
    currentFrame = 0;
    const html = renderToStaticMarkup(<CaptionView node={{ ...caption(), words: [] }} />);
    expect(html).toContain("cut to the beat");
    expect(html).not.toContain("opacity:0.45");
  });
});

/**
 * THE REGRESSION: one hallucinated overlay key killed an export.
 *
 * The reducer accepts ANY overlayKey — the renderable gate filters what the model is OFFERED, not
 * what it can emit. An unknown key fell through to `/overlays/<key>.webm`, and public/overlays/
 * ships only a README, so that src is a guaranteed 404. A missing OffthreadVideo src does not
 * degrade to a blank frame: it crashes renderMedia. So a single invented key took the whole render
 * down, minutes in.
 */
describe("unknown overlay keys", () => {
  const overlay = (overlayKey: string, placement: unknown) =>
    ({
      kind: "overlay",
      id: "ov",
      hash: "",
      overlayKey,
      window: { startFrame: 0, endFrame: 30 },
      placement,
      params: {},
    }) as never;

  test("a key with no procedural renderer paints nothing instead of fetching a 404", () => {
    const html = renderToStaticMarkup(
      <OverlayView node={overlay("overlay-invented-by-the-model", { mode: "static", x: 0, y: 0, w: 100, h: 100 })} />,
    );
    expect(html).toBe("");
    expect(html).not.toContain("/overlays/");
  });

  test("a real procedural key still paints", () => {
    const html = renderToStaticMarkup(<OverlayView node={overlay("overlay-scan-lines", { mode: "center" })} />);
    expect(html).not.toBe("");
  });
});
