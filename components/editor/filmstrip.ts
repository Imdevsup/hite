"use client";
import { useEffect, useState } from "react";

/**
 * THE STRIP'S THUMBNAILS — ART-DIRECTION §13 ("one row of clip blocks with thumbnails"), degraded
 * honestly per the footage rule.
 *
 * ONE DECODE PER ASSET, NOT ONE PER CLIP. A cut turns one asset into six or ten clips, all of them
 * windows onto the same file, so the frames are extracted once from the asset and each clip block
 * samples the one nearest its own midpoint. That is why this is keyed on the asset url and not on
 * the timeline.
 *
 * WHAT HAPPENS WHEN IT CANNOT — and it often cannot, because a cross-origin video that does not send
 * the right headers TAINTS the canvas and `toDataURL` throws. There is no fallback image and there
 * will never be one: §11's ledger has no stock frames in it, and inventing a picture of footage is
 * the same class of untruth as inventing a number. A failed extract returns an empty list, and the
 * strip draws exactly what §17's reduced-data edition and §11's T0 state already specify — "flat
 * `--color-bg-2` with `--line-3` hairlines". A block with no picture is honest; a block with someone
 * else's picture is not.
 *
 * `prefers-reduced-data` is respected for the same reason it is on the landing: decoding a video to
 * paint six 96px thumbnails is real bytes and real power, and the flat block is already a designed
 * state rather than a degradation.
 */

/** How many frames are pulled from one asset. Six across a strip that is rarely wider than 1200px. */
const FRAME_COUNT = 6;
/** Thumbnail pixel width. 2× a 48px block at DPR 2, which is where the strip actually lands. */
const FRAME_W = 192;
/** Give up rather than hold a decoder open on a file the browser cannot seek. */
const TIMEOUT_MS = 12_000;

export interface Filmstrip {
  /** Data URLs in time order, or empty when no frame could be read. Never a placeholder image. */
  readonly frames: readonly string[];
  /** The asset duration the frames were sampled across, in ms. */
  readonly durationMs: number;
}

const EMPTY: Filmstrip = { frames: [], durationMs: 0 };

/** Module cache: one extract per url for the life of the page, shared by every clip that uses it. */
const cache = new Map<string, Promise<Filmstrip>>();

function reducedData(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-data: reduce)").matches === true;
}

/**
 * Decode `FRAME_COUNT` evenly spaced frames from a video url.
 *
 * Every exit path resolves — never rejects — with a real result or with EMPTY. A thumbnail is a
 * nicety; a thrown promise in a render path is not.
 */
function extract(url: string): Promise<Filmstrip> {
  if (typeof document === "undefined") return Promise.resolve(EMPTY);
  return new Promise<Filmstrip>((resolve) => {
    const video = document.createElement("video");
    // The same crossOrigin the duration probe already uses (`lib/editor/probe.ts`). Without it the
    // canvas is tainted and every draw is wasted work.
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    const frames: string[] = [];
    let index = 0;
    let settled = false;
    let durationMs = 0;

    const finish = (result: Filmstrip) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(result);
    };

    // Declared after `finish` and read only from inside it, which is why the cycle is fine: by the
    // time anything calls `finish`, the timer exists.
    const timer = setTimeout(() => finish(frames.length > 0 ? { frames, durationMs } : EMPTY), TIMEOUT_MS);

    const seekNext = () => {
      if (index >= FRAME_COUNT) {
        finish({ frames, durationMs });
        return;
      }
      // Sample at the CENTRE of each of six equal spans, never at 0 — the first frame of a take is
      // very often black, and six black chips would read as a broken strip rather than as footage.
      video.currentTime = (video.duration * (index + 0.5)) / FRAME_COUNT;
    };

    video.addEventListener(
      "loadedmetadata",
      () => {
        if (!Number.isFinite(video.duration) || video.duration <= 0) {
          finish(EMPTY);
          return;
        }
        durationMs = Math.round(video.duration * 1000);
        seekNext();
      },
      { once: true },
    );

    video.addEventListener("seeked", () => {
      if (settled) return;
      try {
        const height = Math.max(1, Math.round((FRAME_W * video.videoHeight) / Math.max(1, video.videoWidth)));
        const canvas = document.createElement("canvas");
        canvas.width = FRAME_W;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish(EMPTY);
          return;
        }
        ctx.drawImage(video, 0, 0, FRAME_W, height);
        // Throws a SecurityError on a tainted canvas — the cross-origin case above. Caught below and
        // reported as "no frames", which is the honest answer.
        frames.push(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        finish(EMPTY);
        return;
      }
      index += 1;
      seekNext();
    });

    video.addEventListener("error", () => finish(EMPTY), { once: true });
    video.src = url;
  });
}

/** Frames for an asset url, extracted once per page and shared. */
export function filmstripFor(url: string | null): Promise<Filmstrip> {
  if (!url || reducedData()) return Promise.resolve(EMPTY);
  const hit = cache.get(url);
  if (hit) return hit;
  const run = extract(url);
  cache.set(url, run);
  return run;
}

/**
 * Which frame belongs at a point in the source media.
 *
 * Clips carry SOURCE ticks (`inTick`/`outTick`), and the frames were sampled across the source, so
 * the mapping is over the media's own timeline rather than the timeline's. A clip that has been
 * moved therefore keeps showing its own footage instead of whatever now sits at that timeline
 * position, which is the difference between a filmstrip and a decoration.
 */
export function frameAt(strip: Filmstrip, sourceMs: number): string | null {
  if (strip.frames.length === 0 || strip.durationMs <= 0) return null;
  const fraction = Math.min(0.999, Math.max(0, sourceMs / strip.durationMs));
  return strip.frames[Math.min(strip.frames.length - 1, Math.floor(fraction * strip.frames.length))];
}

/**
 * Subscribe a component to one asset's filmstrip. EMPTY until (and unless) frames arrive.
 *
 * The result is stored WITH the url it belongs to and compared during render, rather than being
 * cleared by a second `setState` inside the effect: swapping assets must not paint the previous
 * asset's frames onto the new one for a render, and a state write in an effect body to prevent that
 * is a cascading render for something a comparison answers for free.
 */
export function useFilmstrip(url: string | null): Filmstrip {
  const [entry, setEntry] = useState<{ url: string | null; strip: Filmstrip }>({ url, strip: EMPTY });
  useEffect(() => {
    let live = true;
    void filmstripFor(url).then((strip) => {
      if (live) setEntry({ url, strip });
    });
    return () => {
      live = false;
    };
  }, [url]);
  return entry.url === url ? entry.strip : EMPTY;
}
