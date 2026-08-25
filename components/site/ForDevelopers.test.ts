/**
 * components/site/ForDevelopers.test.ts — the anti-drift gate for §6.5.
 *
 * The section makes exactly three factual claims, and each one is checkable against something on
 * disk rather than against a reviewer's memory:
 *
 *   1. THE PATH names five real modules. A rename anywhere in `lib/edl`, `lib/render` or
 *      `lib/remotion` currently produces a landing page confidently linking to a 404. This suite
 *      resolves every path against the filesystem, so the rename fails the build instead.
 *   2. THE QUICKSTART is a sequence that works. `pnpm` is the package manager, `.env.example` is at
 *      the repo root, and the dev script exists — all three are asserted, not assumed.
 *   3. THE LICENSE disclosure matches the repo's own LICENSE. §6.5 requires the Remotion carve-out
 *      to be stated on the page; if LICENSE is amended and the page is not, that is a false
 *      statement about what a company is permitted to do, so the two are pinned together here.
 *
 * Plus the property-wide honesty lint (§7.4): no banned marketing phrase in any copy string.
 *
 * AND ONE RUNTIME CHECK. §9.1 ("invert the sr-only polarity") is the highest-priority fix on the
 * property, and it is only true if the explanation is in the SERVER-RENDERED markup. So the last
 * block actually renders the component with `react-dom/server` — no jsdom, no testing library, no
 * new dependency — and reads the HTML string. That is the difference between "the JSX looks right"
 * and "the bytes a crawler receives contain the sentence".
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MECHANISM_HEADLINE } from "@/lib/landing/fixture";
import {
  ForDevelopers,
  LICENSE_DISCLOSURE,
  PIPELINE,
  quickstartLines,
  repoDirectory,
  type PipelineNode,
} from "./ForDevelopers";

/** Vitest's root is `hite-app/`, which is also the repo root — matching lib/landing/fixture.test.ts. */
const APP_ROOT = process.cwd();
const REPO_URL = "https://github.com/Imdevsup/hite";

/** Everything the section renders as prose, in one place, for the honesty lint. */
const ALL_COPY: readonly string[] = [
  ...PIPELINE.flatMap((n: PipelineNode) => [n.stage, n.path, n.role]),
  ...Object.values(LICENSE_DISCLOSURE),
  ...quickstartLines(REPO_URL),
];

describe("THE PATH — §6.5's architecture flow", () => {
  it("is the five modules the direction names, in order", () => {
    expect(PIPELINE.map((n) => n.path)).toEqual([
      "lib/edl/commands.ts",
      "lib/edl/reducer.ts",
      "lib/edl/schema.ts",
      "lib/render/compile.ts",
      "lib/remotion/HiteRoot.tsx",
    ]);
  });

  it.each(PIPELINE.map((n) => n.path))("links a file that exists on disk: %s", (modulePath) => {
    expect(existsSync(path.join(APP_ROOT, modulePath))).toBe(true);
  });

  it("numbers the stages 01..05 with no gaps", () => {
    expect(PIPELINE.map((n) => n.step)).toEqual(["01", "02", "03", "04", "05"]);
  });

  it("keeps every mono label inside Martian Mono's 24-character rule (§4.3)", () => {
    // The rail's label renders as `NN · STAGE`; the width caveat applies to the whole string.
    for (const node of PIPELINE) {
      expect(`${node.step} · ${node.stage}`.length, node.stage).toBeLessThanOrEqual(24);
    }
  });

  it("describes each module in one sentence, not a paragraph", () => {
    for (const node of PIPELINE) {
      expect(node.role.length, node.path).toBeLessThanOrEqual(72);
      expect(node.role.trim().endsWith("."), node.path).toBe(true);
    }
  });
});

describe("THE QUICKSTART — every line is a command that works today", () => {
  const lines = quickstartLines(REPO_URL);

  it("clones the repo and enters the directory git actually creates", () => {
    expect(lines[0]).toBe(`git clone ${REPO_URL}.git`);
    expect(lines[1]).toBe("cd hite");
  });

  it("normalises a trailing slash or a .git suffix on the repo URL", () => {
    expect(repoDirectory("https://github.com/Imdevsup/hite/")).toBe("hite");
    expect(repoDirectory("https://github.com/Imdevsup/hite.git")).toBe("hite");
    expect(quickstartLines("https://github.com/Imdevsup/hite.git/")[0]).toBe(
      "git clone https://github.com/Imdevsup/hite.git",
    );
  });

  it("copies the env template that really exists at the repo root", () => {
    expect(lines).toContain("cp .env.example .env.local");
    expect(existsSync(path.join(APP_ROOT, ".env.example"))).toBe(true);
  });

  it("uses the package manager this repo is actually locked to", () => {
    expect(lines).toContain("pnpm install");
    expect(existsSync(path.join(APP_ROOT, "pnpm-lock.yaml"))).toBe(true);
  });

  it("ends on a dev script that exists — and does not invent a registry step, because predev owns it", () => {
    const pkg: unknown = JSON.parse(readFileSync(path.join(APP_ROOT, "package.json"), "utf8"));
    const scripts = (pkg as { scripts?: Record<string, string> }).scripts ?? {};
    expect(lines.at(-1)).toBe("pnpm dev");
    expect(scripts.dev).toBeTruthy();
    expect(scripts.predev).toBeTruthy();
    expect(lines.some((l) => l.includes("build-registry"))).toBe(false);
  });
});

describe("THE LICENSE DISCLOSURE — §6.5's required carve-out", () => {
  const license = readFileSync(path.join(APP_ROOT, "LICENSE"), "utf8");

  it("is backed by an MIT LICENSE in the repo", () => {
    expect(license).toContain("MIT License");
    expect(LICENSE_DISCLOSURE.mit).toContain("MIT");
  });

  it("states, as LICENSE does, that Remotion is NOT covered by the MIT grant", () => {
    expect(license).toContain("Remotion is NOT MIT licensed");
    expect(LICENSE_DISCLOSURE.carveOut).toMatch(/^Remotion is not\./);
  });

  it("carries the same three-person threshold LICENSE carries", () => {
    expect(license).toMatch(/up to 3 employees/);
    expect(LICENSE_DISCLOSURE.carveOut).toContain("three people or fewer");
    expect(LICENSE_DISCLOSURE.carveOut).toMatch(/individuals/);
    expect(LICENSE_DISCLOSURE.carveOut).toMatch(/non-profits/);
    expect(LICENSE_DISCLOSURE.carveOut).toMatch(/paid company license/);
  });

  it("repeats LICENSE's point that the engine cannot simply be removed", () => {
    expect(license).toContain("it cannot simply be removed");
    expect(LICENSE_DISCLOSURE.carveOut).toContain("cannot be swapped out");
  });

  it("does not present the summary as legal advice", () => {
    expect(license).toContain("This is not legal advice");
    expect(LICENSE_DISCLOSURE.caveat).toMatch(/out of date/);
  });

  it("names the UNLICENSED package that is really in the tree", () => {
    expect(LICENSE_DISCLOSURE.footnote).toContain("@remotion/web-renderer");
    expect(LICENSE_DISCLOSURE.footnote).toContain("UNLICENSED");
    const pkgPath = path.join(APP_ROOT, "node_modules", "@remotion", "web-renderer", "package.json");
    if (existsSync(pkgPath)) {
      const meta: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
      expect((meta as { license?: string }).license).toBe("UNLICENSED");
    }
  });
});

describe("HONESTY (§7.4)", () => {
  // The same list lib/landing/prompts.test.ts enforces, plus the render-length and price claims
  // this band is the most likely place on the property to reach for.
  const banned = [
    "to the pixel",
    "in seconds",
    "in minutes",
    "instantly",
    "one click",
    "10x",
    "free forever",
    "unlimited",
    "$",
  ];

  it("uses no banned marketing phrase", () => {
    for (const copy of ALL_COPY) {
      const lower = copy.toLowerCase();
      for (const phrase of banned) {
        // The quickstart's clone line is a shell command, not a claim; `$` is only ever the
        // aria-hidden prompt glyph, which is not part of any copy string.
        expect(lower, `${copy} / ${phrase}`).not.toContain(phrase);
      }
    }
  });

  it("never says beta, so the property's two-use budget stays with the FAQ (§6.7)", () => {
    for (const copy of ALL_COPY) {
      expect(copy.toLowerCase(), copy).not.toContain("beta");
    }
  });

  it("makes no claim about a user count, a rating or a customer", () => {
    for (const copy of ALL_COPY) {
      expect(copy).not.toMatch(/\b\d[\d,.]*\s*(users?|creators?|editors?|stars?|customers?)\b/i);
    }
  });
});

describe("SERVER-RENDERED MARKUP (§9.1)", () => {
  /** React escapes `'` and `&` in text nodes; compare against what a reader sees, not the entity. */
  const asText = (markup: string): string =>
    markup.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");

  const html = asText(renderToStaticMarkup(createElement(ForDevelopers, {})));

  it("puts the H2 in the markup as visible text, not inside .sr-only", () => {
    expect(html).toContain("Open source. The whole pipeline is in the repo.");
    // The §9.1 build gate, scoped to this section: no heading may be visually hidden.
    expect(html).not.toMatch(/<h[1-6][^>]*class="[^"]*\bsr-only\b/);
  });

  it("ships every module link with a resolvable href", () => {
    for (const node of PIPELINE) {
      expect(html).toContain(`https://github.com/Imdevsup/hite/blob/master/${node.path}`);
      expect(html).toContain(node.role);
    }
    expect(html).toContain("https://github.com/Imdevsup/hite/blob/master/LICENSE");
  });

  it("honours the repoUrl and branch props everywhere at once", () => {
    const forked = asText(
      renderToStaticMarkup(
        createElement(ForDevelopers, { repoUrl: "https://github.com/acme/hite/", branch: "main" }),
      ),
    );
    expect(forked).toContain("https://github.com/acme/hite/blob/main/lib/edl/commands.ts");
    expect(forked).toContain("git clone https://github.com/acme/hite.git");
    expect(forked).not.toContain("Imdevsup");
  });

  it("states the Remotion carve-out in the markup, not just in a constant", () => {
    expect(html).toContain("three people or fewer");
    expect(html).toContain("@remotion/web-renderer");
  });

  it("prints only generated numbers — no literal count is hard-coded in the JSX", () => {
    expect(html).toContain(`${MECHANISM_HEADLINE.commandCount} EditCommands`);
    expect(html).toContain(`${MECHANISM_HEADLINE.clipCount}-clip`);
    expect(html).toContain(MECHANISM_HEADLINE.timecode);
    // §7.1: the manifest's advertised size is never printed anywhere on the property.
    expect(html).not.toMatch(/\b76\b/);
  });

  it("marks decoration aria-hidden and gives the copy button a status channel", () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("never advertises beat-sync — beats are not wired (lib/render/resolver.ts)", () => {
    expect(html.toLowerCase()).not.toContain("beat");
  });
});

/* §12 — the band ships zero JS. `"use client"` on this 490-line module put the pipeline rail, the
   quickstart and the whole license carve-out into the landing bundle (measured: 2.1KB gzipped) to
   ship one `navigator.clipboard.writeText`. The directive lives in `CopyQuickstart.tsx` now, and
   re-adding it here would silently undo that — the budget gate is the only other thing that notices,
   one build later. */
describe("THE CLIENT BOUNDARY (§12)", () => {
  const source = (file: string): string => readFileSync(path.join(__dirname, file), "utf8");
  const markup = renderToStaticMarkup(createElement(ForDevelopers, {}));

  it("ForDevelopers is a Server Component", () => {
    expect(source("ForDevelopers.tsx")).not.toMatch(/^\s*["']use client["']/);
  });

  it("the copy button is the island, and it carries the status channel with it", () => {
    const island = source("CopyQuickstart.tsx");
    expect(island).toMatch(/^\s*["']use client["']/);
    expect(island).toContain("navigator.clipboard");
    expect(island).toContain('role="status"');
    // Joining two static class strings is not worth tailwind-merge's 6.3KB in the client graph.
    expect(island).not.toContain("@/lib/utils");
  });

  it("copies exactly the commands the page prints — one array, both consumers", () => {
    // The <pre> and the button both render from `lines`, so what is copied cannot drift from what is
    // read. Asserted through the rendered markup: every quickstart line is on screen.
    for (const line of quickstartLines(REPO_URL)) {
      expect(markup).toContain(line);
    }
  });
});
