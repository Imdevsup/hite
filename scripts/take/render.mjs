#!/usr/bin/env node
/**
 * Renders scripts/take/take.html frame by frame and encodes the result.
 *
 * Frame-by-frame rather than a screen capture: `draw(n)` is a pure function of the frame index, so
 * stepping it gives the same bytes every run. A capture would depend on wall-clock timing and this
 * file is COMMITTED — an unreproducible take means a megabyte of meaningless binary diff in the next
 * contributor's pull request.
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import ffmpegPath from "ffmpeg-static";

const OUT = join(process.cwd(), "public", "take", "take.mp4");
const WORK = join(process.cwd(), ".scratch", "take-frames");
const FPS = 30, BPM = 120, DROP_AT = 35;

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve("scripts/take/take.html")).href, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__draw);
const total = await page.evaluate(() => window.__total);
const canvas = page.locator("#c");
console.log(`[take] rendering ${total} frames (${(total / FPS).toFixed(0)}s)`);
for (let n = 0; n < total; n++) {
  await page.evaluate((f) => window.__draw(f), n);
  await canvas.screenshot({ path: join(WORK, `f${String(n).padStart(5, "0")}.jpg`), type: "jpeg", quality: 96 });
  if (n % 90 === 0) process.stdout.write(`[take] ${n}/${total}\r`);
}
await browser.close();
console.log(`\n[take] frames done`);

// The bed: 120 BPM, a riser into the drop and an energy jump after it. Every tone is a whole number
// of cycles per beat — 41 Hz is 20.5 cycles in a half-second beat, so alternate beats invert and
// autocorrelation reports 60 BPM for a 120 BPM track. Confirmed by running the real analyser.
const beat = 60 / BPM;
const dur = total / FPS;
const E = (s) => s.replace(/,/g, String.fromCharCode(92) + ",");
const A = [
  E(`0.40*sin(2*PI*62*t)*exp(-11*mod(t,${beat}))`),
  E(`0.24*sin(2*PI*40*t)*exp(-7*mod(t,${beat}))`),
  E(`0.075*sin(2*PI*5200*t)*exp(-64*mod(t,${beat / 2}))`),
  E(`if(between(t,${DROP_AT - 2},${DROP_AT}),0.16*sin(2*PI*(260+900*(t-${DROP_AT - 2})/2)*t)*((t-${DROP_AT - 2})/2),0)`),
  E(`if(gte(t,${DROP_AT}),0.30*sin(2*PI*32*t)*exp(-4*mod(t,${beat})),0)`),
].join("+");
const audio = `aevalsrc='(${A})*${E(`if(gte(t,${DROP_AT}),1.22,1.0)`)}':s=48000:d=${dur}`;

console.log(`[take] encoding -> ${OUT}`);
execFileSync(ffmpegPath, [
  "-y", "-hide_banner", "-loglevel", "error",
  "-framerate", String(FPS), "-i", join(WORK, "f%05d.jpg"),
  "-f", "lavfi", "-i", audio,
  "-map", "0:v", "-map", "1:a",
  "-c:v", "libx264", "-preset", "slow", "-crf", "20",
  "-pix_fmt", "yuv420p", "-g", String(FPS * 2),
  "-threads", "1",
  "-x264-params", "threads=1:lookahead_threads=1:sliced_threads=0:deterministic=1",
  "-flags:v", "+bitexact", "-flags:a", "+bitexact", "-fflags", "+bitexact",
  "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
  "-t", String(dur),
  OUT,
], { stdio: ["ignore", "inherit", "inherit"] });
rmSync(WORK, { recursive: true, force: true });
console.log("[take] done");
