"use client";
import { createBrowserClient } from "@supabase/ssr";

/**
 * The browser-side Supabase config, or a thrown error naming what is missing.
 *
 * Direct-to-storage uploads need the project url and the anon key OUTSIDE the client
 * object (the upload speaks raw XHR so it can report byte progress), so the two reads
 * moved here rather than being duplicated with `!` assertions at each call site. `!` on a
 * missing env var produces `undefined` inside a url and a 404 from a host called
 * "undefined" — a config mistake reported as a network mystery.
 */
export function supabaseBrowserConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return { url, anonKey };
}

/**
 * The browser client exists for ONE job now: reading the session that `middleware.ts` already
 * minted, so a direct-to-storage upload can sign itself (`components/editor/mediaUpload.ts`).
 * It never signs anyone in — there is no sign-in screen.
 *
 * A `{ auth: { flowType: "pkce" } }` pin used to sit here to make OAuth return a `?code=` for the
 * `/auth/callback` route to exchange. That route and the Google/magic-link UI are deleted, so the
 * pin configured a flow nothing runs and pointed at a file that no longer exists.
 */
export function createClient() {
  const { url, anonKey } = supabaseBrowserConfig();
  return createBrowserClient(url, anonKey);
}
