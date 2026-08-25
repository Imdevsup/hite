/**
 * Client-side media duration probe. Used right after a Blob upload to
 * seed the Preview's EDL with a single-clip placeholder so the user
 * sees their video on the workbench immediately — without waiting for
 * the sandbox ffprobe step to land.
 *
 * Falls back gracefully if metadata can't load (CORS, codec we can't
 * decode): we just return null and Preview stays on the empty state
 * until the server-side probe catches up.
 */

export interface ProbeResult {
  durationMs: number;
  width?: number;
  height?: number;
}

export async function probeMediaClientSide(url: string, kind: "video" | "audio" | "image"): Promise<ProbeResult | null> {
  if (kind === "image" || typeof document === "undefined") return null;

  const el = kind === "video" ? document.createElement("video") : document.createElement("audio");
  el.crossOrigin = "anonymous";
  el.preload = "metadata";
  el.src = url;

  return new Promise<ProbeResult | null>((resolve) => {
    const cleanup = () => {
      el.removeAttribute("src");
      el.load();
    };
    el.addEventListener("loadedmetadata", () => {
      const durationMs = Math.round((el.duration || 0) * 1000);
      const width = kind === "video" ? (el as HTMLVideoElement).videoWidth : undefined;
      const height = kind === "video" ? (el as HTMLVideoElement).videoHeight : undefined;
      cleanup();
      if (!Number.isFinite(durationMs) || durationMs <= 0) resolve(null);
      else resolve({ durationMs, width, height });
    }, { once: true });
    el.addEventListener("error", () => { cleanup(); resolve(null); }, { once: true });
    setTimeout(() => { cleanup(); resolve(null); }, 10_000);
  });
}
