import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Session refresh + app-route gating.
 *
 * Perf: when the auth cookie holds an access token that is still fresh, we
 * skip the Supabase auth round trip entirely — every data query is still
 * RLS-enforced by the token itself, so a forged cookie only buys a 500, not
 * data. The network call happens only when the token is missing or near
 * expiry (refresh), which is when it's actually needed.
 */

function sessionExpiry(request: NextRequest): number | null {
  const chunks = request.cookies
    .getAll()
    .filter((c) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (chunks.length === 0) return null;
  const joined = chunks.map((c) => c.value).join("");
  try {
    const raw = joined.startsWith("base64-")
      ? atob(joined.slice(7).replace(/-/g, "+").replace(/_/g, "/"))
      : decodeURIComponent(joined);
    const session = JSON.parse(raw) as { expires_at?: number };
    return typeof session.expires_at === "number" ? session.expires_at : null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request });
  if (!url || !anon) return response;

  const path = request.nextUrl.pathname;
  const isAppRoute =
    path.startsWith("/dashboard") || path.startsWith("/personas") || path.startsWith("/conversations") ||
    path.startsWith("/monitoring") || path.startsWith("/settings") || (path.startsWith("/sim/") && path !== "/sim/demo");

  const expiresAt = sessionExpiry(request);

  // fast path: token present and >60s from expiry — no auth round trip
  if (expiresAt !== null && expiresAt * 1000 - Date.now() > 60_000) return response;

  // no session at all on an app route — straight to login, no round trip
  if (expiresAt === null && isAppRoute) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", path);
    return NextResponse.redirect(redirect);
  }
  if (expiresAt === null) return response;

  // stale/near-expiry token: refresh via Supabase (sets new cookies)
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && isAppRoute) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", path);
    return NextResponse.redirect(redirect);
  }
  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/personas/:path*", "/conversations/:path*", "/monitoring/:path*", "/settings/:path*", "/sim/:path*", "/login"],
};
