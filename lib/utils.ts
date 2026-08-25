import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** SMPTE `HH:MM:SS:FF` for a given ms at a given fps. Never decimal. */
export function smpte(ms: number, fps = 29.97): string {
  if (!Number.isFinite(ms) || ms < 0) return "00:00:00:00";
  const totalFrames = Math.round((ms / 1000) * fps);
  const ff = totalFrames % Math.round(fps);
  const totalSeconds = Math.floor(totalFrames / Math.round(fps));
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return [hh, mm, ss, ff].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Clamp between lo and hi (inclusive). */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Debounce — trailing edge. */
export function debounce<T extends (...args: never[]) => unknown>(fn: T, wait: number): T {
  let t: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  }) as T;
}

/** 8-grid snap used by window drag + overlays. */
export function snap8(n: number): number {
  return Math.round(n / 8) * 8;
}
