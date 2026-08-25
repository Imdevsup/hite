import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { EFFORT_LEVELS } from "@/lib/ai/effort";
import { BYOK_DISCLOSURE } from "@/lib/ai/keys";

/**
 * THE SOURCE GATES for the provider picker.
 *
 * `honesty.test.ts` is the settings SHEET's gate and it scopes itself to that unit's files, on the
 * stated grounds that "a shared directory is not a shared contract". This is the same gate for the
 * other unit in the directory, and the list below is checked against the directory so a new file
 * cannot quietly escape it.
 *
 * These read source rather than markup because the failures they hunt are only visible in what was
 * written. A hand-asserted `verified`, a retyped disclosure and a hardcoded rung name all render
 * perfectly on the one code path anyone tests; the point is that they must not be writable at all.
 */

const DIR = join(process.cwd(), "components", "settings");

const OWNED = [
  "providerOptions.ts",
  "providerPreference.ts",
  "providerHeaders.ts",
  "ProviderPicker.tsx",
  "ProviderPickerPanel.tsx",
] as const;

const SOURCES = OWNED.map((name) => ({ name, text: readFileSync(join(DIR, name), "utf8") }));

test("every file this unit wrote is under the gates", () => {
  const onDisk = new Set(readdirSync(DIR));
  for (const name of OWNED) expect(onDisk.has(name), `${name} is listed but missing`).toBe(true);
});

describe("no file can assert that something works", () => {
  /**
   * THE CENTRAL GATE. `Verification` is a discriminated union, so the only way to fabricate a green
   * badge is to construct one — `{ state: "verified", … }`. `lib/ai/providers/verification.ts` is the
   * one module allowed to do that, from the harness's committed result file. If this unit ever builds
   * one, a model would show as measured when nothing measured it, which is the exact failure the
   * three-state design exists to prevent.
   */
  test("nothing constructs a verification — they all come from verificationFor", () => {
    for (const { name, text } of SOURCES) {
      expect(text, `${name} builds a verification literal`).not.toMatch(/state:\s*["']verified["']/);
      expect(text, `${name} builds a verification literal`).not.toMatch(/state:\s*["']broken["']/);
      expect(text, `${name} builds a verification literal`).not.toMatch(/state:\s*["']untested["']/);
    }
  });

  /**
   * Type-only imports are fine and are what a presentational component should use — they are erased
   * by the compiler and carry no behaviour. What must not happen is a component reaching for the
   * registry or `verificationFor` at RUNTIME and deriving a badge of its own, beside the one owner.
   */
  test("only the derivation module CALLS the registry and the result file", () => {
    const valueImport = /^import\s+(?!type\b)[^;]*from\s+["']@\/lib\/ai\/providers\/(registry|verification)["']/m;
    for (const { name, text } of SOURCES) {
      if (name === "providerOptions.ts") continue;
      expect(text, `${name} imports the registry for value, not just types`).not.toMatch(valueImport);
      expect(text, `${name} derives its own verification`).not.toMatch(/\bverificationFor\s*\(/);
    }
  });

  test("no reliability-shaped vocabulary is hardcoded as UI copy", () => {
    for (const { name, text } of SOURCES) {
      // "recommended" is banned in the registry's data for the same reason it is banned here: it is a
      // reliability claim wearing a helpful hat, and nothing has measured it.
      expect(text.toLowerCase(), name).not.toMatch(/["'][^"']*\brecommended\b[^"']*["']/);
      expect(text.toLowerCase(), name).not.toMatch(/["'][^"']*\bguaranteed\b[^"']*["']/);
    }
  });
});

describe("the ladder and the disclosure keep their owners", () => {
  test("no source file hardcodes a rung name as a string literal", () => {
    for (const { name, text } of SOURCES) {
      for (const rung of EFFORT_LEVELS) {
        expect(text, `${name} hard-codes the rung "${rung}"`).not.toMatch(new RegExp(`["']${rung}["']`));
      }
    }
  });

  test("no file retypes any sentence of BYOK_DISCLOSURE", () => {
    const sentences = BYOK_DISCLOSURE.split(". ")
      .map((s) => s.trim())
      .filter((s) => s.length > 20);
    expect(sentences.length).toBeGreaterThan(1);
    for (const { name, text } of SOURCES) {
      for (const sentence of sentences) {
        expect(text, `${name} retypes the disclosure instead of rendering it`).not.toContain(sentence);
      }
    }
  });
});

describe("the secret cannot leak through this unit", () => {
  test("no masking glyphs — the display is fingerprintKey or nothing", () => {
    for (const { name, text } of SOURCES) {
      expect(text, name).not.toMatch(/[•·●∙]{2,}/);
      expect(text, name).not.toMatch(/\*{4,}/);
    }
  });

  test("nothing logs, at all", () => {
    for (const { name, text } of SOURCES) {
      expect(text, name).not.toMatch(/console\s*\.\s*(log|info|debug|warn|error|trace)\s*\(/);
    }
  });

  test("nothing claims the key stays in the browser", () => {
    for (const { name, text } of SOURCES) {
      expect(text.toLowerCase(), name).not.toContain("never sent");
      expect(text.toLowerCase(), name).not.toContain("never leaves");
    }
  });

  test("the key travels in a header and nowhere else — no query string, no reveal toggle", () => {
    for (const { name, text } of SOURCES) {
      expect(text, name).not.toMatch(/[?&]key=/);
      expect(text, name).not.toMatch(/type=\{?["']text["']\}?[^>]*password/i);
      // §14.1: "There is no reveal affordance." A toggle would need a piece of state named for it.
      expect(text, name).not.toMatch(/\bshow(Key|Secret|Password)\b/i);
    }
  });
});

describe("designed states, not browser dialogs", () => {
  test("no alert, confirm or prompt anywhere on this surface", () => {
    for (const { name, text } of SOURCES) {
      expect(text, name).not.toMatch(/\balert\s*\(/);
      expect(text, name).not.toMatch(/\bconfirm\s*\(/);
      expect(text, name).not.toMatch(/window\s*\.\s*prompt\s*\(/);
    }
  });

  test("every colour and measure comes from a design token, never a raw hex", () => {
    for (const { name, text } of SOURCES) {
      if (!name.endsWith(".tsx")) continue;
      // A literal hex in a component is a value that cannot follow the palette.
      expect(text, `${name} hardcodes a colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});

describe("typing", () => {
  test("no escape hatches", () => {
    for (const { name, text } of SOURCES) {
      expect(text, name).not.toMatch(/:\s*any\b/);
      expect(text, name).not.toMatch(/\bas\s+any\b/);
      expect(text, name).not.toMatch(/@ts-(ignore|expect-error|nocheck)/);
    }
  });

  /** The registry is client-safe precisely so this surface can render from it. That guarantee dies
   *  the moment one of these files imports a provider package, so the gate is on IMPORTS — naming one
   *  in a comment is how the reason gets recorded. */
  test("no provider SDK is imported into a client component", () => {
    const sdkImport = /from\s+["']@(ai-sdk|openrouter)\//;
    for (const { name, text } of SOURCES) {
      expect(text, `${name} would pull a provider SDK into the browser`).not.toMatch(sdkImport);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE RENDERED GATE.

   Everything above reads SOURCE, and source gates cannot see the claim a visitor actually reads: a
   badge computed correctly and then dropped from the markup, or a row rendered without one at all,
   passes every grep in this file. So this one renders the REAL registry through the REAL picker and
   asserts on the markup — the only place the claim is made.
   ───────────────────────────────────────────────────────────────────────────────────────── */

describe("what a visitor actually reads", () => {
  test("every model row of every provider carries a badge, and none says VERIFIED without a run", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ProviderPicker } = await import("./ProviderPicker");
    const { providerOptions } = await import("./providerOptions");
    const { PROVIDERS } = await import("@/lib/ai/providers/registry");
    const { allRuns } = await import("@/lib/ai/providers/verification");

    const policy = { disclosure: BYOK_DISCLOSURE, deployerCeiling: null, localEnabled: true };
    const render = (providerId: string, modelId: string) =>
      renderToStaticMarkup(
        createElement(ProviderPicker, {
          providers: providerOptions(policy),
          disclosure: BYOK_DISCLOSURE,
          deployerCeiling: null,
          selection: { providerId, modelId, surface: null, effort: EFFORT_LEVELS[0] },
          onSelectionChange: () => {},
          credential: { status: "absent" },
          onSubmitCredential: () => {},
          onClearCredential: () => {},
        } as never),
      );

    // A model may only read VERIFIED where a `pass` record exists. Derived from the committed file,
    // so this stays correct the day a real run lands rather than pinning "everything is untested".
    const passing = new Set(
      allRuns().filter((r) => r.verdict === "pass").map((r) => `${r.provider}/${r.model}`),
    );

    let rows = 0;
    for (const provider of PROVIDERS) {
      const markup = render(provider.id, provider.models[0]?.id ?? "");
      const text = markup.replace(/<[^>]*>/g, " ");

      // The PROVIDER row's own badge, checked by WORD and not merely for presence. It is rendered by
      // a different code path from the model rows (`BADGE_WORD` here, `describeVerification` there),
      // so asserting only "some badge is present" leaves one of the two paths ungated — which is
      // exactly what a negative control caught when this test was first written.
      const providerRow = markup.slice(markup.indexOf(`value="${provider.id}"`), markup.indexOf(`value="${provider.id}"`) + 900);
      const providerBadge = /VERIFIED|UNTESTED|KNOWN ISSUE/.exec(providerRow.replace(/<[^>]*>/g, " "))?.[0] ?? null;
      expect(providerBadge, `${provider.id} renders no badge at all`).not.toBeNull();
      const providerHasPass = provider.models.some((m) => passing.has(`${provider.id}/${m.id}`));
      expect(
        providerBadge === "VERIFIED",
        `${provider.id} renders VERIFIED with no passing run behind any of its models`,
      ).toBe(providerHasPass);
      void text;

      for (const model of provider.models) {
        rows += 1;
        const at = markup.indexOf(`value="${model.id}"`);
        expect(at, `${provider.id}/${model.id} is not offered in the markup`).toBeGreaterThan(-1);
        const row = markup.slice(at, at + 2200).replace(/<[^>]*>/g, " ");
        const badge = /VERIFIED|UNTESTED|KNOWN ISSUE/.exec(row)?.[0] ?? null;
        expect(badge, `${provider.id}/${model.id} renders no verification badge`).not.toBeNull();
        expect(
          badge === "VERIFIED",
          `${provider.id}/${model.id} renders VERIFIED with no passing run in verified.json`,
        ).toBe(passing.has(`${provider.id}/${model.id}`));
      }
    }
    // Guards the guard: a registry that lost its models would make every assertion above vacuous.
    expect(rows).toBeGreaterThan(10);
  });
});
