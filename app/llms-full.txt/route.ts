/**
 * `/llms-full.txt` — DESIGN-DIRECTION §9.4, served as a route handler.
 *
 * The complete, self-contained document `/llms.txt` links to. Same construction, same reason: the
 * body is built in `lib/seo/llms.ts` from the live catalogue gate and the live prompt allowlist, so
 * it cannot drift the way two hand-edited files in `public/` did.
 */
import { LLMS_FULL_TXT } from "@/lib/seo/llms";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(LLMS_FULL_TXT, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
