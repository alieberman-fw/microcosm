import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/**
 * Session user from the cookie, no auth-server round trip. Safe for page
 * data-fetching: every query is RLS-enforced by the access token itself, so
 * a forged cookie yields empty results, never data. Middleware still does
 * the verified refresh when the token is stale. Keep `auth.getUser()` for
 * API routes that mutate.
 */
export async function getLocalUser(supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabase>>>) {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

export async function createServerSupabase() {
  const env = supabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  return createServerClient(env.url, env.anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // called from a Server Component — middleware handles refresh
        }
      },
    },
  });
}
