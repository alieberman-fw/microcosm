import { SupabaseClient, createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client for server-side workers — the walk-away slice chain
 * (3c) runs with no user session, so RLS-scoped clients can't drive it.
 * Returns null when the key isn't configured; callers MUST fall back to
 * client-driven continuation in that case. Server-only — never import
 * from client components.
 */
export function createAdminSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
