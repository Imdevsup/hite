import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Session mint for `/app/*`. THERE IS NO SIGN-IN SCREEN AND NOBODY IS EVER ASKED FOR AN EMAIL.
 *
 * This used to be an auth GATE: no cookie → 307 to `/login`. That login wall was the single largest
 * piece of friction in front of "type a sentence, get an edit", so it is gone — but the user concept
 * behind it is NOT. Every table is scoped by `project.owner_user_id` and protected by RLS
 * (migrations 001/005/006), every storage object is keyed by a `{userId}/…` prefix, and every rate
 * limit is per user. Deleting the user would mean deleting all of that, and a self-hosted HITE on a
 * public URL would then serve every visitor's raw footage to every other visitor.
 *
 * So instead of removing the session, we stop asking for it: a visitor with no cookie gets a
 * Supabase ANONYMOUS session minted here, silently. `auth.uid()` exists from the first request,
 * every policy keeps working unchanged, and the visitor just lands in the editor.
 *
 * WHY THE COOKIE PLUMBING BELOW IS SHAPED LIKE THIS. A minted session has to be visible in two
 * places: on the response (so the browser keeps it) and back on the REQUEST (so the Server Component
 * rendering this very request already sees it — otherwise `/app` renders signed-out once, and the
 * project list would come back empty on the first paint). `req.cookies.set()` rewrites the request's
 * `cookie` header, and `NextResponse.next({ request: req })` forwards the request headers downstream
 * — but it snapshots them at call time, so the response is rebuilt after each write rather than
 * created once up front.
 *
 * Only `/app/*` is matched. API routes deliberately keep returning 401 to a caller with no session
 * (`lib/api/auth.ts`): minting there would create a user row for every unauthenticated request that
 * ever reaches `/api/*`, which is a trivial flood, and it would silently void the auth-boundary probe
 * (`qa/probe/auth-boundary.spec.ts`). A browser always enters through `/app`, so it always has a
 * session by the time it calls an API; a 401 now means the session genuinely expired, and reloading
 * the page — which comes back through here — is a real fix, which is what the UI now says.
 */

type SessionCookie = { name: string; value: string; options: CookieOptions };

/** A configuration/availability failure a visitor can act on. Never a redirect — there is nowhere to go. */
function plainText(status: number, body: string): NextResponse {
  return new NextResponse(body, { status, headers: { "content-type": "text/plain" } });
}

export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Config missing — a plain-text 503 with actionable copy, rather than letting Supabase's
    // constructor throw a generic MIDDLEWARE_INVOCATION_FAILED.
    return plainText(
      503,
      "HITE is not configured yet. Set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const written: SessionCookie[] = [];
  // Supabase hands `setAll` the no-store headers a session-setting response MUST carry, so a CDN
  // never caches one visitor's `Set-Cookie` and serves it to the next. We forward them verbatim.
  const noStore: Record<string, string> = {};
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookies, headers) => {
        for (const { name, value, options } of cookies) {
          // maxAge 0 is Supabase expiring a stale chunk. Forwarding it as an empty-string cookie
          // would hand the Server Component a cookie that exists but holds nothing.
          if (options.maxAge === 0) req.cookies.delete(name);
          else req.cookies.set(name, value);
        }
        written.push(...cookies);
        Object.assign(noStore, headers);

        res = NextResponse.next({ request: req });
        for (const c of written) res.cookies.set(c.name, c.value, c.options);
        for (const [key, value] of Object.entries(noStore)) res.headers.set(key, value);
      },
    },
  });

  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.error("[middleware] anonymous sign-in failed:", error.message);
        return plainText(
          503,
          `HITE couldn't start a session — ${error.message}\n\n` +
            "If you are self-hosting: enable anonymous sign-ins for this Supabase project " +
            "(Dashboard → Authentication → Sign In / Providers, or `enable_anonymous_sign_ins = true` " +
            "in supabase/config.toml locally). HITE has no login page to fall back to.",
        );
      }
    }
  } catch (e) {
    console.error("[middleware] supabase error:", (e as Error).message);
    return plainText(503, "Auth service unavailable — try again in a moment.");
  }

  return res;
}

export const config = {
  // `/app/*` only. `/login` and `/verify` were here; both routes are deleted.
  matcher: ["/app/:path*"],
};
