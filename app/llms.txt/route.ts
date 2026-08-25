/**
 * `/llms.txt` — DESIGN-DIRECTION §9.4, served as a route handler.
 *
 * It replaces `public/llms.txt` and `public/.well-known/llms.txt`, which §10.1 deletes. The document
 * itself lives in `lib/seo/llms.ts`, where the catalogue size, the prompt list and the origin are
 * interpolated from the same sources the page renders from; this file is only the transport.
 *
 * `force-static` prerenders it at build time — the body is a module constant with no request input,
 * so there is nothing to compute per request and no reason to give up the CDN.
 */
import { LLMS_TXT } from "@/lib/seo/llms";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(LLMS_TXT, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
