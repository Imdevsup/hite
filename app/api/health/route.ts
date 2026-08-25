import { NextResponse } from "next/server";

/**
 * Integration health check — surfaces which env-gated features are ready.
 * Called on app load so the TopBar can tell the user up front when
 * something needs wiring (instead of crashing mid-flow with a 500).
 */

interface CheckResult {
  key: string;
  label: string;
  ok: boolean;
  hint?: string;
}

function envSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export function GET() {
  const checks: CheckResult[] = [
    {
      key: "supabase",
      label: "Supabase",
      ok: envSet("NEXT_PUBLIC_SUPABASE_URL") && envSet("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      hint: "Set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    },
    {
      key: "supabase_admin",
      label: "Supabase (admin)",
      ok: envSet("SUPABASE_SERVICE_ROLE_KEY"),
      hint: "Set SUPABASE_SERVICE_ROLE_KEY for analyze/render background work.",
    },
    // No storage check: uploads, exports and previews are Supabase Storage buckets created by
    // migration 005, so they are covered by the `supabase` check above and need no variable of
    // their own. A `blob` check for BLOB_READ_WRITE_TOKEN used to live here and reported a
    // correctly-configured install as "degraded" for a service nothing reads any more.
    {
      key: "ai",
      label: "AI provider (BYOK)",
      // HITE is bring-your-own-key: the model credential arrives per request in a header, is never
      // stored, and is never read from the environment on a request path. So there is no deployer
      // variable to check — a deployment with no model key is correctly configured, not degraded.
      // (`GEMINI_API_KEYS` survives ONLY as a developer/test convenience for
      // scripts/verify-provider.ts and the integration tests; reporting on it here would tell an
      // operator to set a variable the product does not read.)
      ok: true,
      hint: "Users supply their own provider key in settings — no server-side model key is required.",
    },
    {
      key: "groq",
      label: "Groq (Whisper)",
      ok: envSet("GROQ_API_KEY"),
      hint: "Set GROQ_API_KEY for transcription (captions, dead-air detection).",
    },
  ];

  const allOk = checks.every((c) => c.ok);
  // "Critical" = the app can serve its core loop: a session, and a model to plan with.
  const criticalOk =
    checks.find((c) => c.key === "supabase")?.ok && checks.find((c) => c.key === "ai")?.ok;

  return NextResponse.json({
    status: allOk ? "ok" : criticalOk ? "degraded" : "unconfigured",
    checks,
  });
}
