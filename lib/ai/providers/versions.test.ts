import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { PROVIDERS } from "./registry";

/**
 * THE AI SDK VERSION WALL — the single highest-value guard in this unit.
 *
 * `ai@6` speaks `@ai-sdk/provider@3.x` (`LanguageModelV3`). Every `@ai-sdk/*` provider has since
 * shipped a 4.x line built on `@ai-sdk/provider@4.x` — the AI SDK **7** interface — and `latest` on
 * npm points at it. `pnpm add @ai-sdk/openai` therefore installs a package that cannot drive this
 * repo's `streamText`, and the failure does not read as "wrong major": it is a type mismatch at the
 * call site and a specification-version rejection at runtime, i.e. "the SDK is broken".
 *
 * Three packages have an OFFSET major (`@ai-sdk/deepseek` and `@ai-sdk/openai-compatible` are on
 * 2.x, `@openrouter/ai-sdk-provider` on 2.x), which is the trap inside the trap: the pin that is
 * right for six of them is wrong for the other three.
 *
 * This test walks the INSTALLED tree, so it fails at `pnpm test` rather than at a user's first
 * prompt, and it kills the whole class — including the next time someone runs `pnpm up --latest`.
 *
 * Note it asserts the MAJOR, not the exact version: nested minor differences are normal and fine
 * (this tree really does resolve `@ai-sdk/provider` 3.0.8 for `ai` and 3.0.10 for `@ai-sdk/google`,
 * and both work).
 */

const ROOT = process.cwd();

interface PackageJson {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function readPackage(spec: string): PackageJson {
  return JSON.parse(readFileSync(join(ROOT, "node_modules", ...spec.split("/"), "package.json"), "utf8")) as PackageJson;
}

function majorOf(range: string): number | null {
  const major = Number.parseInt(range.trim().replace(/^[\^~>=<\s]*/, ""), 10);
  return Number.isInteger(major) ? major : null;
}

/** The interface version `ai` itself compiles against — the number everything else must match. */
const AI_PROVIDER_MAJOR = majorOf(readPackage("ai").dependencies?.["@ai-sdk/provider"] ?? "");

describe("every provider package speaks the same @ai-sdk/provider major as `ai`", () => {
  test("`ai` declares one we can read", () => {
    expect(AI_PROVIDER_MAJOR).not.toBeNull();
  });

  for (const entry of PROVIDERS) {
    if (!entry.npm) continue;
    test(`${entry.npm.pkg} is installed and on @ai-sdk/provider@${AI_PROVIDER_MAJOR}.x`, () => {
      const pkg = readPackage(entry.npm!.pkg);
      // The registry's declared range must also match what is installed, or the registry is
      // advertising a package the deployment does not have.
      expect(majorOf(pkg.version), `${entry.npm!.pkg} installed`).toBe(majorOf(entry.npm!.range));

      const declared = pkg.dependencies?.["@ai-sdk/provider"] ?? pkg.peerDependencies?.["@ai-sdk/provider"];
      if (declared) {
        expect(majorOf(declared), `${entry.npm!.pkg} → @ai-sdk/provider`).toBe(AI_PROVIDER_MAJOR);
        return;
      }
      // A community provider may peer on `ai` instead of on the interface package. Then THAT is the
      // thing to check, and it is just as decisive.
      const peersAi = pkg.peerDependencies?.ai;
      expect(peersAi, `${entry.npm!.pkg} declares neither @ai-sdk/provider nor an ai peer`).toBeTruthy();
      expect(majorOf(peersAi!), `${entry.npm!.pkg} → ai peer`).toBe(majorOf(readPackage("ai").version));
    });
  }
});

describe("package.json pins the ranges the registry advertises", () => {
  test("every provider package is a direct dependency at the registry's range", () => {
    // A transitive dependency is not a contract: `@ai-sdk/openai-compatible` arrives via
    // `@ai-sdk/xai` today, and would vanish the day xAI is dropped. It must be declared directly.
    const app = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as PackageJson;
    for (const entry of PROVIDERS) {
      if (!entry.npm) continue;
      expect(app.dependencies?.[entry.npm.pkg], entry.npm.pkg).toBe(entry.npm.range);
    }
  });

  test("@ai-sdk/gateway is NOT a HITE dependency", () => {
    // It is installed transitively by `ai@6` and reaches many models through one key — which makes
    // it look like the cheapest possible answer to this whole unit. It is the wrong answer: a
    // Gateway credential is the DEPLOYER'S Vercel account, i.e. exactly the shared key pool BYOK
    // removed. Named here so nobody rediscovers the package and reintroduces the pool by accident.
    const app = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as PackageJson;
    expect(app.dependencies?.["@ai-sdk/gateway"]).toBeUndefined();
  });
});
