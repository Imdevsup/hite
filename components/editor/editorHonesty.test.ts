import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMPLE_PROMPT_TEXTS } from "@/lib/landing/prompts";

/**
 * FOUR GATES OVER THE WHOLE EDITOR. Each one was a live regression in this tree, not a hypothetical.
 *
 * 1. EXAMPLE PROMPTS COME FROM THE ALLOWLIST. `lib/landing/prompts.ts` is the one array on the
 *    property whose test runs every entry through the real flat mapper and the real reducer and
 *    requires a command that actually changes the EDL. The editor used to carry two hand-written
 *    lists that bypassed it, and two of those entries asked for beat sync. Beats are NOT WIRED
 *    (`planBeatCuts` returns `{ bpm: 0, cutTicks: [] }`), so the first thing a new user was invited
 *    to press produced a turn that reported success and changed nothing. ART-DIRECTION §13's brief
 *    repeats it: "Beat detection is NOT wired — never show beat-sync."
 *
 * 2. SHORTCUT LABELS ARE NOT HARDCODED APPLE GLYPHS. Every binding uses `mod` (Ctrl off Apple);
 *    every label used to be ⌘/⇧/⌫. Labels come from `formatShortcut`.
 *
 * 3. NOTHING §13 KILLS BY NAME COMES BACK. §13 ends with a kill list — WORKSHOP, THE PATCH LOG,
 *    PREVIEW ENGINE, SMPTE, `Ctrl+K for commands`, the tool rail, the floating windows. A previous
 *    unit argued the eleven panels were "capability, not clutter" and merely DEMOTED them; the owner
 *    rejected that. This scan is what stops the next session from demoting them again.
 *
 * 4. A RAW REGISTRY KEY NEVER REACHES THE UI. §13's second hard rule for `/` completions: "A raw
 *    registry key never appears in the UI. Ever." A key literal typed into a component would bypass
 *    `completions.ts`'s whole design, so no component may contain one.
 *
 * All four scan the editor's real source, so a new file inherits the rules without anyone remembering
 * them.
 */

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..", "..");

/**
 * The editor's own surfaces. `components/site` is the landing and `components/settings` is the
 * settings unit; both have their own gates.
 */
const SCANNED_ROOTS = [join(appRoot, "components", "editor"), join(appRoot, "app", "app")];

/** The module that DEFINES the platform glyphs. */
const GLYPH_SOURCE = join(appRoot, "components", "editor", "platformKeys.ts");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = SCANNED_ROOTS.flatMap(walk);

/** Source with comments and JSX comment blocks removed — prose about a glyph is not a label. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SOURCES = FILES.map((file) => ({ path: relative(appRoot, file), code: code(file) }));

test("the scan actually found the editor (a silent zero would pass every gate below)", () => {
  expect(FILES.length).toBeGreaterThan(15);
  const names = SOURCES.map((s) => s.path);
  for (const required of ["EditorFrame.tsx", "Composer.tsx", "Strip.tsx", "Picture.tsx", "EmptyState.tsx"]) {
    expect(names.some((n) => n.endsWith(required)), `${required} not found`).toBe(true);
  }
});

describe("example prompts come from the allowlist, and only from it", () => {
  /**
   * Capability claims that are false in this build. Each is a phrase that used to sit in an editor
   * component as an inviting example: beats are not wired, and captions are on the out-list until the
   * capability is verified in prod.
   */
  const UNWIRED_CLAIMS = [
    "to the beat",
    "beat sync",
    "beat-sync",
    "sync every cut",
    "sync the cuts",
    "on the drop",
    "each kick",
    "bass hit",
    "add captions",
  ];

  test("no editor surface advertises a capability this build does not have", () => {
    const offenders: string[] = [];
    for (const { path, code: source } of SOURCES) {
      const lower = source.toLowerCase();
      for (const claim of UNWIRED_CLAIMS) {
        if (lower.includes(claim)) offenders.push(`${path} → "${claim}"`);
      }
    }
    expect(offenders, "these read as things a user can ask for, and they are not").toEqual([]);
  });

  test("the one surface that shows example prompts imports the allowlist", () => {
    // There is exactly one now — §13's empty state. If a second appears it has to import the same
    // array to pass the claim scan above, which is the point.
    const offering = SOURCES.filter((s) => s.code.includes("EXAMPLE_PROMPTS"));
    expect(offering.length, "expected exactly one surface offering example prompts").toBe(1);
    expect(offering[0].path).toMatch(/EmptyState\.tsx$/);
    expect(offering[0].code).toContain("@/lib/landing/prompts");
  });

  test("the allowlist itself still contains nothing beat-related", () => {
    for (const text of EXAMPLE_PROMPT_TEXTS) {
      expect(text.toLowerCase()).not.toContain("beat");
    }
    expect(EXAMPLE_PROMPT_TEXTS.length).toBeGreaterThan(0);
  });
});

describe("shortcut labels are rendered for the reader's keyboard", () => {
  const APPLE_GLYPHS = ["⌘", "⇧", "⌥", "⌫", "⏎"];

  test("no editor component hardcodes an Apple modifier glyph", () => {
    const offenders: string[] = [];
    for (const { path, code: source } of SOURCES) {
      if (join(appRoot, path) === GLYPH_SOURCE) continue; // this file DEFINES them
      for (const glyph of APPLE_GLYPHS) {
        if (source.includes(glyph)) offenders.push(`${path} → ${glyph}`);
      }
    }
    expect(
      offenders,
      "labels must come from formatShortcut(binding, useModifierKeys()) so Windows/Linux see Ctrl",
    ).toEqual([]);
  });

  test("developer-speak failure copy is gone", () => {
    for (const { path, code: source } of SOURCES) {
      expect(source.toLowerCase(), `${path} still tells the user to check logs`).not.toContain("check logs");
    }
  });
});

describe("ART-DIRECTION §13's kill list stays killed", () => {
  /**
   * "Killed by name" — §13's own closing list, plus the two things the brief for this rebuild names
   * again. Matched against RENDERED STRING LITERALS and identifiers, with comments stripped, so a
   * file is free to explain what it deleted (this one does) without failing its own gate.
   */
  const KILLED: readonly (readonly [string, string])[] = [
    ["WORKSHOP", "the breadcrumb on the first screen"],
    ["PATCH LOG", "the chat panel's title"],
    ["1 TO WIRE", "the status chip"],
    ["PREVIEW ENGINE", "the readout strip over the picture"],
    ["30FPS", "the format strip"],
    ["H.264", "the format strip"],
    ["I/O TRIM", "the timeline header"],
    ["S SPLIT", "the timeline header"],
    ["react-rnd", "the eleven floating windows"],
    ["WindowManager", "the eleven floating windows"],
    ["FloatingWindow", "the eleven floating windows"],
    ["CursorLayer", "the custom cursor"],
    ["GrainOverlay", "grain over the program monitor"],
    ["ShortcutOverlay", "shortcut hints before the user has acted"],
    ["for commands", "the Ctrl+K hint pill"],
    ["for shortcuts", "the ? hint pill"],
    ["smpte", "SMPTE anywhere"],
  ];

  test("no editor source contains anything §13 deletes by name", () => {
    const offenders: string[] = [];
    for (const { path, code: source } of SOURCES) {
      const lower = source.toLowerCase();
      for (const [needle, why] of KILLED) {
        if (lower.includes(needle.toLowerCase())) offenders.push(`${path} → "${needle}" (${why})`);
      }
    }
    expect(offenders, "ART-DIRECTION §13 kills these by name; a previous unit demoted them instead").toEqual([]);
  });

  test("the editor mounts no toast surface, so no component may reach for one", () => {
    // `app/app/layout.tsx` no longer renders a `<Toaster>`: §13 gives the editor one place to report
    // an AI edit (the history line) and one place to report a failure (`EditorAlerts`), and a
    // `toast()` call with nothing mounted is a silent failure, not a quiet one.
    for (const { path, code: source } of SOURCES) {
      expect(source, `${path} calls toast() but nothing renders toasts any more`).not.toContain("sonner");
    }
  });
});

describe("a raw registry key never appears in the UI", () => {
  /**
   * Real keys from the manifest's own namespaces. The `/` menu shows `entry.label` — the manifest's
   * human-facing name — and emits the key only through the planner, so a key literal in a component
   * means someone put the machine's vocabulary on screen.
   */
  const KEY_SHAPES = /\b(lut|look|trans|curve|grain|glitch|zoom|chromatic|eq|compressor)-[a-z0-9]+-[a-z0-9-]+\b/;

  test("no editor component contains a registry key literal", () => {
    const offenders: string[] = [];
    for (const { path, code: source } of SOURCES) {
      const hit = source.match(KEY_SHAPES);
      if (hit) offenders.push(`${path} → "${hit[0]}"`);
    }
    expect(offenders, "§13: 'A raw registry key never appears in the UI. Ever.'").toEqual([]);
  });
});
