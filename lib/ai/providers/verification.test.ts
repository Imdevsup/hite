import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PROVIDERS } from "./registry";
import { VERIFIED_AI_MAJOR, allRuns, majorOf, verificationFor } from "./verification";

/**
 * Verification is a DERIVATION. These tests pin the two things that make that claim real:
 *
 *  1. an id with no run record is `untested` — including Gemini, the incumbent;
 *  2. every ambiguity resolves DOWNWARD. A `pass` missing its date, a run from another SDK major, an
 *     unparseable record: all `untested`. Downgrades are safe; an upgrade is how a dropdown of
 *     thirty providers ends up half silently failing.
 */

const FILE = join(process.cwd(), "public", "providers", "verified.json");

describe("the committed result file", () => {
  test("is valid JSON with the schema the harness writes", () => {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as { schema: number; runs: unknown[]; note?: string };
    expect(raw.schema).toBe(1);
    expect(Array.isArray(raw.runs)).toBe(true);
    expect(raw.note).toMatch(/GENERATED/);
  });

  test("holds no key material of any shape", () => {
    // The harness reads a key from the environment and must never write one into its output.
    const text = readFileSync(FILE, "utf8");
    expect(text).not.toMatch(/AIza[A-Za-z0-9_-]{10,}/);
    expect(text).not.toMatch(/\bsk-[A-Za-z0-9-]{20,}/);
    expect(text.toLowerCase()).not.toContain("api_key");
  });

  test("every record it does contain parses cleanly — a dropped record is a silent lost result", () => {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as { runs: unknown[] };
    expect(allRuns().length).toBe(raw.runs.length);
  });
});

describe("a badge exists ONLY where a run record does", () => {
  test("an id with no run record is `untested`", () => {
    expect(verificationFor("openrouter", "some-vendor/model-nobody-measured")).toEqual({ state: "untested" });
    expect(verificationFor("google", "gemini-9-ultra-preview")).toEqual({ state: "untested" });
  });

  test("EVERY non-untested badge in the shipped registry traces to a real run record", () => {
    // The derivation, asserted rather than assumed. If a model shows `verified` there must be a
    // `pass` record for it, dated, at a rung, against THIS SDK major — and if it shows `broken`
    // there must be a matching non-pass record. There is no third way to produce either state.
    for (const entry of PROVIDERS) {
      for (const m of entry.models) {
        const verification = verificationFor(entry.id, m.id, m.surface);
        if (verification.state === "untested") continue;

        const backing = allRuns().filter(
          (r) => r.provider === entry.id && r.model === m.id && majorOf(r.versions.ai) === VERIFIED_AI_MAJOR,
        );
        expect(backing.length, `${entry.id}/${m.id}`).toBeGreaterThan(0);
        const newest = backing.reduce((a, b) => (b.at > a.at ? b : a));

        if (verification.state === "verified") {
          expect(newest.verdict, `${entry.id}/${m.id}`).toBe("pass");
          expect(verification.at).toBe(newest.at.slice(0, 10));
          expect(verification.rung).toBe(newest.rung);
        } else {
          expect(newest.verdict, `${entry.id}/${m.id}`).not.toBe("pass");
          expect(verification.reason.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("a `pass` recorded against another SDK major is NOT evidence for this build", () => {
    // Guards the staleness rule without needing a stale record on disk: every record the file does
    // carry is either evidence for THIS major or invisible, and nothing in between.
    for (const run of allRuns()) {
      if (majorOf(run.versions.ai) === VERIFIED_AI_MAJOR) continue;
      const verification = verificationFor(run.provider, run.model, run.surface);
      const alsoCurrent = allRuns().some(
        (r) => r.provider === run.provider && r.model === run.model && majorOf(r.versions.ai) === VERIFIED_AI_MAJOR,
      );
      if (!alsoCurrent) expect(verification).toEqual({ state: "untested" });
    }
  });
});

describe("majorOf", () => {
  test("reads the major out of a version string, and refuses to guess at nonsense", () => {
    expect(majorOf("6.0.168")).toBe(6);
    expect(majorOf("^7.1.0")).toBe(7);
    expect(majorOf(" 6.0.0 ")).toBe(6);
    expect(majorOf("unknown")).toBeNull();
    expect(majorOf("")).toBeNull();
  });

  test("the pinned major matches the AI SDK this build actually resolves", () => {
    // If this fails, `ai` was upgraded across a major and every committed result stopped being
    // evidence for this build. Bump VERIFIED_AI_MAJOR in the same commit and re-measure.
    const installed = JSON.parse(
      readFileSync(join(process.cwd(), "node_modules", "ai", "package.json"), "utf8"),
    ) as { version: string };
    expect(majorOf(installed.version)).toBe(VERIFIED_AI_MAJOR);
  });
});
