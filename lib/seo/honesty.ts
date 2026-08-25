/**
 * lib/seo/honesty.ts — DESIGN-DIRECTION §7.4, THE BANNED-PHRASE LINT.
 *
 * §7.4: "The rule already exists for components. It must also cover `public/llms.txt`,
 * `public/.well-known/llms.txt`, the `.md` twins, the JSON-LD, and the OG image copy." Until
 * 2026-08-19 the rule existed only as a private array re-declared inside each landing component's
 * own test file — six copies, none of which looked at the six marketing pages, the two llms.txt
 * files, or the structured data. Those surfaces shipped `to the pixel` eleven times, a per-render
 * length cap four times, and an upgrade path for a product with no payment path.
 *
 * THIS IS THE ONE OWNER. A component test that wants the check should import `BANNED_PHRASES` from
 * here rather than re-typing it; `honesty.test.ts` runs it across the whole property.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS SCANS RENDERED COPY, NOT SOURCE TEXT.
 *
 * A source-text grep has to decide whether a hit is copy or a code comment, and the only way to do
 * that is to parse TypeScript — at which point a regex literal containing a quote, or an apostrophe
 * in JSX text, silently desynchronises the parser and the lint starts missing real violations while
 * flagging documentation that quotes the rule it enforces. Rendered HTML has neither problem: a
 * comment cannot render, an interpolated count arrives resolved, and what the scanner sees is
 * exactly what a reader and an answer engine see. The functions below therefore take TEXT, and
 * `honesty.test.ts` supplies it by server-rendering the pages and reading the static files.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

/** One banned construction, plus the reason — the reason is what makes a failure actionable. */
export interface BannedPhrase {
  /** Matched case-insensitively against the rendered copy. Global flag is added by the scanner. */
  readonly pattern: RegExp;
  /** What is wrong with it, in the direction's own terms. Printed on failure. */
  readonly why: string;
}

/**
 * §7.4, in full: "Banned, everywhere: `to the pixel` · `in seconds` · `in minutes` · any
 * render-length cap · any Pro price or Buy button · any fabricated metric, testimonial, logo, user
 * count, or rating."
 *
 * Each entry cites the source that makes the claim false, so nobody has to re-derive it.
 */
export const BANNED_PHRASES: readonly BannedPhrase[] = [
  {
    pattern: /to the pixel/i,
    why:
      "Overclaims a WYSIWYG guarantee the code documents as an approximation: the LUT and colour " +
      "entries are CSS-filter approximations (lib/remotion/fx/ColorGrade.tsx) and 23 of 36 " +
      "transitions do not perform the treatment their name describes. §7.4 bans the phrase outright.",
  },
  {
    pattern: /\bin seconds\b/i,
    why: "A time-to-result claim nothing measures. §7.4 bans it.",
  },
  {
    pattern: /\bin minutes\b/i,
    why: "A time-to-result claim nothing measures. §7.4 bans it.",
  },
  {
    pattern: /\b(?:length|render|duration|export)[- ]cap(?:s|ped)?\b|\bcap on (?:render|export|length)/i,
    why: "§7.4 bans any render-length cap. No cap is implemented, and advertising one invents a limit.",
  },
  {
    // Deliberately NOT a bare /upgrade|checkout/: the honest copy has to be able to SAY there is no
    // checkout and no paid tier, and a lint that forbids the denial as loudly as the claim is a lint
    // nobody can satisfy. What is banned is the offer — the sentence that sells a tier.
    pattern:
      /\bpro plan\b|\bpaid plan\b|\bpremium plan\b|\bbuy now\b|\badd to cart\b|\bstart (?:your )?free trial\b|\bupgrade to\b|\bupgrad(?:e|es|ing) (?:removes|unlocks|raises|lifts)\b|\b(?:removed|unlocked|lifted|raised) on upgrade\b/i,
    why:
      "Advertises a paid tier. There is NO payment path in this codebase (§6.8: 'A pricing section " +
      "for a product with no checkout is not a design decision, it is a lie').",
  },
  {
    pattern: /(?:^|[^\w])\$\s?\d|\b\d+\s*(?:usd|eur)\b|\/\s?mo\b|\bper month\b/i,
    why: "A price. §7.4 bans any Pro price; there is no payment path.",
  },
  {
    pattern: /\baggregate ?rating\b|\bratingValue\b|\b\d(?:\.\d)?\s*(?:\/\s*5|out of 5|stars?)\b|★/i,
    why: "A rating. There are no real ratings, so any rating here is fabricated (§7.4).",
  },
  {
    pattern: /\btrusted by\b|\bjoin \d|\b\d[\d,.]*\s*\+?\s*(?:users|creators|editors|customers|teams)\b/i,
    why: "A fabricated user count or social-proof claim. §7.4 bans it; no such number exists.",
  },
  {
    pattern: /\b76[- ](?:effects?|entries|entry)\b|\b76 (?:effects?|entries)\b/i,
    why:
      "The manifest advertises 76 entries and the renderer paints 39 of them (§7.1). The number in " +
      "the copy must be interpolated from RENDERABLE_ENTRY_COUNT, never typed.",
  },
];

/** §7.4: "'beta' at most twice on the property." */
export const BETA_LIMIT = 2;

/** Where a violation was found, and what it was. */
export interface HonestyViolation {
  /** The surface the text came from — a route, a component, or a file path. */
  readonly source: string;
  /** The matched text, exactly as it renders. */
  readonly match: string;
  /** ~60 characters of surrounding copy, so the failure names the sentence to fix. */
  readonly context: string;
  readonly why: string;
}

/** Every banned construction in `text`, with enough context to locate the sentence. */
export function scanCopy(text: string, source: string): HonestyViolation[] {
  const found: HonestyViolation[] = [];
  for (const { pattern, why } of BANNED_PHRASES) {
    const rx = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const m of text.matchAll(rx)) {
      const at = m.index ?? 0;
      found.push({
        source,
        match: m[0],
        context: text.slice(Math.max(0, at - 60), at + m[0].length + 60).replace(/\s+/g, " ").trim(),
        why,
      });
    }
  }
  return found;
}

/** How many times the word "beta" appears (whole word, case-insensitive). */
export function countBeta(text: string): number {
  return text.match(/\bbeta\b/gi)?.length ?? 0;
}

/**
 * Rendered HTML → the copy a reader actually sees.
 *
 * `<script>` and `<style>` bodies are dropped first: the JSON-LD graph is checked separately as
 * data (its `featureList` is quoted verbatim by answer engines, so it gets its own assertions), and
 * a component-scoped stylesheet is not prose. Entities are decoded because the repo escapes
 * apostrophes as `&rsquo;`/`&apos;`, and an un-decoded entity would hide a phrase from the scanner.
 */
export function htmlToCopy(html: string): string {
  const withoutInert = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");

  // Attribute values that ARE copy — aria-label, alt and title are read aloud, so they are in scope.
  const spokenAttributes = [...withoutInert.matchAll(/\b(?:aria-label|alt|title)="([^"]*)"/gi)]
    .map((m) => m[1])
    .join(" ");

  const text = `${withoutInert.replace(/<[^>]+>/g, " ")} ${spokenAttributes}`;
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  middot: "·",
  times: "×",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Render a violation list as a failure message a reviewer can act on without opening the file. */
export function formatViolations(violations: readonly HonestyViolation[]): string {
  return violations
    .map((v) => `\n  ${v.source}: "${v.match}"\n    …${v.context}…\n    ${v.why}`)
    .join("");
}
