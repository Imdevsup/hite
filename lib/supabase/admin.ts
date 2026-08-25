import { createClient } from "@supabase/supabase-js";

/**
 * Admin client — uses the service_role key. Only import from server code.
 * Bypasses RLS; use sparingly and never with unauthenticated user input.
 */
export function createAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
