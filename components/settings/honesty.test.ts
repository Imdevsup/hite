import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { EFFORT_LEVELS } from "@/lib/ai/effort";
import { BYOK_DISCLOSURE } from "@/lib/ai/keys";

/**
 * THE SOURCE GATES — §20's row for this unit, written as a test rather than as a promise.
 *
 * "A test asserts that the rendered disclosure string === BYOK_DISCLOSURE and that no component
 * contains the substrings 'Never sent', '••••', or a hard-coded rung name."
 *
 * The render half lives in panel.test.tsx. This half reads the unit's own source, because the three
 * defects §14 names — the softened disclosure, the masked-chip display and a retyped ladder — are
 * all things you can only catch by looking at what was written, not at what happened to render on
 * one code path.
 */

const DIR = join(process.cwd(), "components", "settings");

/**
 * SCOPED TO THIS UNIT'S OWN FILES, deliberately.
 *
 * `components/settings/` also holds the multi-provider picker, which is a different unit with its
 * own suite. Scanning it here would make one unit's gate fail for another unit's choices, and a
 * shared directory is not a shared contract. Every file this unit wrote is named, and the list is
 * checked against the directory so a new file cannot quietly escape the gates.
 */
const OWNED = [
  "types.ts",
  "providerKey.ts",
  "effortPreference.ts",
  "ProviderKeyField.tsx",
  "DataFlow.tsx",
  "SettingsSheet.tsx",
  "settings.module.css",
  "index.ts",
] as const;

/**
 * The picker unit's files, named here ONLY so the directory check below can be exhaustive.
 * `pickerHonesty.test.ts` is what actually gates them; this list must not grow assertions.
 */
const UNDER_THE_PICKER_GATE = [
  "providerOptions.ts",
  "providerPreference.ts",
  "providerHeaders.ts",
  "ProviderPicker.tsx",
  "ProviderPickerPanel.tsx",
] as const;

/**
 * Comments stripped, for the gates that are about CODE.
 *
 * A prose line explaining why the key is never written to `console.*`, or a JSX comment beginning
 * "§10: any pending state…", is not the defect those gates exist to catch — and a scan that cannot
 * tell a rule from an explanation of the rule gets weakened until it stops failing, which is how a
 * gate quietly stops guarding. The prose gates below (the softened disclosure, the masking glyphs,
 * the banned phrases) still read the WHOLE file, because there the words themselves are the defect.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // Never a URL's `//`, which is why the character before it is captured and put back.
    .replace(/(^|[^:])\/\/.*/g, "$1");
}

const SOURCES = OWNED.map((name) => {
  const text = readFileSync(join(DIR, name), "utf8");
  return { name, text, code: code(text) };
});

test("every file this unit wrote is under the gates", () => {
  const onDisk = new Set(readdirSync(DIR).filter((n) => /\.(ts|tsx|css)$/.test(n) && !/\.test[.-]/.test(n)));
  for (const name of OWNED) expect(onDisk.has(name), `${name} is listed but missing`).toBe(true);

  /**
   * AND THE OTHER DIRECTION, which is the half that was missing. The header above promises "the list
   * is checked against the directory so a new file cannot quietly escape the gates", but the loop
   * above only proves a LISTED file exists — a new source file was gated by nobody. It cost real
   * money: `credential.ts` was written, exported from `index.ts`, imported by nothing, and sat here
   * unread by either suite until a human counted the files by hand.
   */
  const gated = new Set<string>([...OWNED, ...UNDER_THE_PICKER_GATE]);
  for (const name of onDisk) {
    expect(gated.has(name), `${name} is in components/settings and under no source gate`).toBe(true);
  }
});

describe("the key display cannot be the one lib/ai/keys.ts rules out by name", () => {
  test("no masking glyphs anywhere — the display is fingerprintKey or nothing", () => {
    for (const { name, text } of SOURCES) {
      expect(text, name).not.toMatch(/[•·●∙]{2,}/);
      expect(text, name).not.toMatch(/\*{4,}/);
    }
  });

  test("nothing claims the key is not sent to this server", () => {
    for (const { name, text } of SOURCES) {
      expect(text.toLowerCase(), name).not.toContain("never sent");
    }
  });
});

describe("the disclosure has exactly one author, and it is not this unit", () => {
  test("no file retypes any sentence of BYOK_DISCLOSURE", () => {
    const sentences = BYOK_DISCLOSURE.split(". ").map((s) => s.trim()).filter((s) => s.length > 24);
    expect(sentences.length).toBeGreaterThan(1);
    for (const { name, text } of SOURCES) {
      for (const sentence of sentences) expect(text, `${name} retypes the disclosure`).not.toContain(sentence);
    }
  });
});

describe("no rung name is written down", () => {
  /**
   * §14.2: "Four ticks on one 320px track: draft · standard · high · max. The shipped enum." The
   * names must come from `effort.levels` at runtime, so a re-tuned or renamed ladder cannot leave a
   * settings sheet describing rungs that no longer exist.
   */
  test("no source file contains a rung name as a string literal", () => {
    for (const level of EFFORT_LEVELS) {
      const literal = new RegExp(`(["'\`])${level}\\1`);
      for (const { name, code: source } of SOURCES) {
        expect(source, `${name} hard-codes the rung "${level}"`).not.toMatch(literal);
      }
    }
  });
});

describe("the honesty rules that bind every surface on this property", () => {
  test("no banned marketing phrase", () => {
    for (const { name, text } of SOURCES) {
      const lower = text.toLowerCase();
      expect(lower, name).not.toContain("to the pixel");
      expect(lower, name).not.toContain("in seconds");
      expect(lower, name).not.toContain("in minutes");
    }
  });

  test("nothing mentions beat sync — beat detection is not wired", () => {
    for (const { name, text } of SOURCES) {
      expect(text.toLowerCase(), name).not.toMatch(/beat[- ]?(sync|detect)/);
    }
  });

  test("no limit is announced with an alert()", () => {
    for (const { name, text } of SOURCES) {
      expect(text, name).not.toMatch(/\balert\s*\(/);
    }
  });
});

describe("the never-log contract reaches the client", () => {
  test("the module that holds key material never writes to the console", () => {
    const store = SOURCES.find((s) => s.name === "providerKey.ts");
    expect(store).toBeDefined();
    expect(store?.code).not.toMatch(/console\s*\./);
  });

  test("no file in the unit logs at all", () => {
    for (const { name, code: source } of SOURCES) {
      expect(source, name).not.toMatch(/console\s*\.\s*\w+\s*\(/);
    }
  });
});

describe("the type ladder is honoured", () => {
  test("no escape hatch typing", () => {
    for (const { name, code: source } of SOURCES) {
      expect(source, name).not.toMatch(/:\s*any\b/);
      expect(source, name).not.toMatch(/\bas\s+any\b/);
    }
  });

  test("the server-only AI modules are imported for TYPES only", () => {
    // A value import of lib/ai/effort or lib/ai/keys from a client module would ship a provider SDK
    // to the browser and run a provider constructor there. There is no exception left: the one
    // "use server" module in this unit (effortLadder.ts) went with the Gemini-only panel.
    for (const { name, text } of SOURCES) {
      const imports = text.match(/^import[^;]*from\s+["']@\/lib\/ai\/[^"']+["'];/gm) ?? [];
      for (const line of imports) expect(line, name).toMatch(/^(import type|export type)\b/);
    }
  });
});

describe("§5's 12px floor and §16's contrast rungs", () => {
  const css = SOURCES.find((s) => s.name === "settings.module.css");

  test("every font-size resolves through a scale token, so nothing can land under 12px", () => {
    expect(css).toBeDefined();
    const sizes = [...(css?.text.matchAll(/font-size:\s*([^;]+);/g) ?? [])].map((m) => m[1].trim());
    expect(sizes.length).toBeGreaterThan(5);
    for (const size of sizes) {
      expect(size, `raw font-size "${size}" — §5 states sizes as tokens, never literals`).toMatch(
        /^var\(--fs-(label|sm|body|lead|h3|h2|hero|numeral)\)$/,
      );
    }
  });

  test("every motion rule is authored inside prefers-reduced-motion: no-preference", () => {
    const text = css?.text ?? "";
    // Strip the guarded blocks, then assert nothing animated survives outside them.
    const unguarded = text.replace(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}/g,
      "",
    );
    expect(unguarded).not.toMatch(/\btransition:/);
    expect(unguarded).not.toMatch(/\banimation:/);
  });

  test("no hairline below --line-5 is a control's sole boundary", () => {
    // A `border:` shorthand is the only construction that makes a rung a control's whole boundary.
    const borders = [...(css?.text.matchAll(/^\s*border:\s*([^;]+);/gm) ?? [])].map((m) => m[1].trim());
    expect(borders.length).toBeGreaterThan(0);
    for (const border of borders) {
      expect(border).toMatch(/var\(--line-5\)|var\(--line-3\)/);
    }
  });
});
