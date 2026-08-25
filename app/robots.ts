import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo/jsonld";

/**
 * robots.txt — crawler + answer-engine policy.
 *
 * GEO note: the AI answer-engines we WANT to cite HITE crawl with their own user-agents and only
 * read what they're explicitly allowed. We allowlist the citation/answer bots (OpenAI, Perplexity,
 * Anthropic, and the user-initiated fetchers ChatGPT-User / Perplexity-User) the same as a normal
 * crawler: everything public, nothing under /app or /api. The wildcard rule already covers them, but
 * naming them makes intent explicit and is robust to any future tightening of the `*` rule.
 *
 * /app + /api stay disallowed for crawling; the editor is *additionally* deindexed via
 * `metadata.robots.index:false` in app/app/layout.tsx (disallow alone does not deindex a discovered URL).
 */
export default function robots(): MetadataRoute.Robots {
  const base = SITE_URL;
  const disallow = ["/app/", "/api/"];

  // Answer/citation engines we explicitly welcome (GEO).
  const answerBots = [
    "OAI-SearchBot", // OpenAI search index
    "ChatGPT-User", // ChatGPT user-initiated browsing
    "PerplexityBot", // Perplexity index
    "Perplexity-User", // Perplexity user-initiated fetch
    "ClaudeBot", // Anthropic index
    "Claude-User", // Claude user-initiated fetch
    "Google-Extended", // Gemini / AI Overviews training+grounding opt-in
  ];

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...answerBots.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
