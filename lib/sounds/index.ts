"use client";
import { Howl } from "howler";

/**
 * Tiny sound effect registry. All SFX live under /public/sfx and are
 * lazy-loaded on first call. Volume is tamed so nothing is startling.
 *
 * Load errors are warn-logged (review S2-CQ3A: the original "swallow"
 * behaviour made missing files undebuggable — a 404 on /sfx/tick.wav
 * would manifest as silence, not an error). SFX remain non-blocking —
 * the play() call becomes a no-op — but the warning tells you *why*.
 */
const REGISTRY: Record<string, { src: string; volume: number }> = {
  "tick":         { src: "/sfx/tick.wav",        volume: 0.25 },
  "genie-open":   { src: "/sfx/genie-open.wav",  volume: 0.35 },
  "genie-close":  { src: "/sfx/genie-close.wav", volume: 0.35 },
  "export-done":  { src: "/sfx/export-done.wav", volume: 0.5 },
  "playhead":     { src: "/sfx/playhead.wav",    volume: 0.15 },
};

const instances = new Map<string, Howl>();
const errored = new Set<string>();

export function playSound(key: keyof typeof REGISTRY | string, volumeOverride?: number) {
  if (typeof window === "undefined") return;
  const entry = REGISTRY[key];
  if (!entry) {
    console.warn(`[sfx] unknown key: ${key}`);
    return;
  }
  if (errored.has(key)) return; // skip permanently-broken files after first warn
  let howl = instances.get(key);
  if (!howl) {
    howl = new Howl({
      src: [entry.src],
      volume: volumeOverride ?? entry.volume,
      preload: true,
      html5: false,
      onloaderror: (_id, err) => {
        errored.add(key);
        console.warn(`[sfx] load error for "${key}" (${entry.src}):`, err);
      },
      onplayerror: (_id, err) => {
        console.warn(`[sfx] play error for "${key}":`, err);
      },
    });
    instances.set(key, howl);
  }
  howl.volume(volumeOverride ?? entry.volume);
  howl.play();
}

export function muteAll() {
  instances.forEach((h) => h.mute(true));
}

export function unmuteAll() {
  instances.forEach((h) => h.mute(false));
}
