import { createClient } from "@/lib/supabase/server";
import { HttpError } from "@/lib/api/errors";
import type { User } from "@supabase/supabase-js";

/**
 * Authentication helper for API route handlers.
 *
 * Throws a `Response` (401) when there is no authenticated user. Call at the
 * top of every protected route instead of duplicating the 3-line dance:
 *
 *     const supabase = await createClient();
 *     const { data: { user } } = await supabase.auth.getUser();
 *     if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
 *
 * Usage:
 *     export async function POST(req: Request) {
 *       const { user, supabase } = await requireUser();
 *       // ... user is non-null here; `supabase` is the RLS-aware client
 *     }
 *
 * The thrown `Response` is caught by the Next.js router — the route returns
 * the 401 verbatim. No wrapper function needed.
 */

export class UnauthorizedError extends HttpError {
  constructor() {
    super(401, "unauthorized");
    this.name = "UnauthorizedError";
  }
}

export interface AuthedContext {
  user: User;
  supabase: Awaited<ReturnType<typeof createClient>>;
}

export async function requireUser(): Promise<AuthedContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();
  return { user, supabase };
}

/**
 * Wrap a handler to translate an `HttpError` into its response so callers don't need their own
 * try/catch. That covers `UnauthorizedError` (401), the body parser's `BadRequestError` (400) and
 * the rate-limit gate's 429 — every failure that already knows its own status.
 *
 * Deliberately narrow: only `HttpError` is converted. A bare `ZodError` (e.g. re-validating a row
 * loaded from the database) or any other throw stays a 500, because that IS a server fault and
 * must keep alerting. Client-input validation belongs in `parseJsonBody`, which throws a
 * `BadRequestError` — that is what turns a malformed body into a 400 instead of a 500.
 */
export async function withAuth<T>(handler: (ctx: AuthedContext) => Promise<T>): Promise<T | Response> {
  try {
    const ctx = await requireUser();
    return await handler(ctx);
  } catch (e) {
    if (e instanceof HttpError) return e.response;
    throw e;
  }
}
