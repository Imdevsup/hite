import { describe, expect, test, vi, beforeEach } from "vitest";

/**
 * The sign-in wall is gone, and these are the four things that has to mean.
 *
 *   1. A cookieless visitor to `/app` is NOT redirected — they get an anonymous session minted in
 *      place. A regression here reintroduces a login bounce to a route that no longer exists (a 404
 *      loop), which is why "never a 3xx" is asserted on every branch, including the failure ones.
 *   2. The minted cookie is visible to the SERVER COMPONENT RENDERING THE SAME REQUEST, not just to
 *      the browser on the next one. That is the whole point of rebuilding the response after the
 *      cookie write, and it is invisible in a response-only assertion — so the forwarded request
 *      header (`x-middleware-request-cookie`, which is how `NextResponse.next({ request })` carries
 *      modified request headers downstream) is asserted directly.
 *   3. A visitor who already has a session is left alone — no second user per page view.
 *   4. Failures fail LOUD (503 + why), because the old escape hatch was "send them to /login".
 */

type CookieToSet = { name: string; value: string; options: Record<string, unknown> };
type SetAll = (cookies: CookieToSet[], headers: Record<string, string>) => void;

const SESSION_COOKIE = "sb-127-auth-token";
const NO_STORE = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

const state = {
  user: null as { id: string } | null,
  signInError: null as { message: string } | null,
  signInCalls: 0,
  getUserThrows: false,
  /** Extra cookies Supabase expires alongside the new one (stale chunks). */
  staleChunks: [] as string[],
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { getAll: () => { name: string; value: string }[]; setAll: SetAll } },
  ) => ({
    auth: {
      getUser: async () => {
        if (state.getUserThrows) throw new Error("fetch failed");
        return { data: { user: state.user }, error: null };
      },
      signInAnonymously: async () => {
        state.signInCalls += 1;
        if (state.signInError) return { data: { user: null, session: null }, error: state.signInError };
        state.user = { id: "anon-user-1" };
        // Mirrors @supabase/ssr's real `applyServerStorage` call: expired chunks first (maxAge 0),
        // then the new session cookie, plus the no-store headers.
        opts.cookies.setAll(
          [
            ...state.staleChunks.map((name) => ({ name, value: "", options: { path: "/", maxAge: 0 } })),
            { name: SESSION_COOKIE, value: "anon-jwt", options: { path: "/", maxAge: 3600 } },
          ],
          NO_STORE,
        );
        return { data: { user: state.user, session: {} }, error: null };
      },
    },
  }),
}));

const { middleware, config } = await import("./middleware");

async function call(path: string, cookie?: string) {
  const { NextRequest } = await import("next/server");
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return middleware(new NextRequest(new Request(`https://tryhite.xyz${path}`, { headers })));
}

/** What `NextResponse.next({ request })` forwards to the handler as the request's own cookies. */
const forwardedCookie = (res: Response) => res.headers.get("x-middleware-request-cookie") ?? "";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54421";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  state.user = null;
  state.signInError = null;
  state.signInCalls = 0;
  state.getUserThrows = false;
  state.staleChunks = [];
});

describe("middleware — a cookieless visitor is let in, not bounced", () => {
  test("no session on /app → an anonymous session is minted and NOTHING redirects", async () => {
    const res = await call("/app");
    expect(state.signInCalls).toBe(1);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  test("the minted cookie is on the response, so the browser keeps the session", async () => {
    const res = await call("/app");
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBe("anon-jwt");
  });

  test("the minted cookie is forwarded on the SAME request, so /app renders signed in on first paint", async () => {
    const res = await call("/app/some-project");
    expect(forwardedCookie(res)).toContain(`${SESSION_COOKIE}=anon-jwt`);
  });

  test("a cookie Supabase expired is deleted from the forwarded request, not forwarded empty", async () => {
    state.staleChunks = [`${SESSION_COOKIE}.0`];
    const res = await call("/app", `${SESSION_COOKIE}.0=old-chunk`);
    expect(forwardedCookie(res)).not.toContain(`${SESSION_COOKIE}.0`);
    expect(forwardedCookie(res)).toContain(`${SESSION_COOKIE}=anon-jwt`);
    // The browser still has to be told to drop it.
    expect(res.cookies.get(`${SESSION_COOKIE}.0`)?.value).toBe("");
  });

  test("the no-store headers Supabase demands ride along, so no CDN caches one visitor's Set-Cookie", async () => {
    const res = await call("/app");
    expect(res.headers.get("cache-control")).toBe(NO_STORE["Cache-Control"]);
    expect(res.headers.get("pragma")).toBe("no-cache");
  });
});

describe("middleware — an existing session is left alone", () => {
  test("a visitor who already has a user gets no second anonymous user", async () => {
    state.user = { id: "returning-user" };
    const res = await call("/app", `${SESSION_COOKIE}=existing-jwt`);
    expect(state.signInCalls).toBe(0);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("middleware — failures are loud, and are never a login redirect", () => {
  test("missing Supabase config → 503 naming the variables", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await call("/app");
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  test("anonymous sign-ins disabled on the project → 503 saying exactly that", async () => {
    state.signInError = { message: "Anonymous sign-ins are disabled" };
    const res = await call("/app");
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
    const body = await res.text();
    expect(body).toContain("Anonymous sign-ins are disabled");
    expect(body).toContain("enable_anonymous_sign_ins");
  });

  test("auth service unreachable → 503, still no redirect", async () => {
    state.getUserThrows = true;
    const res = await call("/app");
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("middleware — the matcher", () => {
  test("only /app/* is matched; /login and /verify are gone from the app entirely", () => {
    expect(config.matcher).toEqual(["/app/:path*"]);
  });
});
