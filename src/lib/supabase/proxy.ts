import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { destinationFor } from "../auth-state";

/** Refreshes the session cookie and bounces unauthenticated / not-yet-2FA users. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const { data: aal } = user ? await supabase.auth.mfa.getAuthenticatorAssuranceLevel() : { data: null };
  const path = request.nextUrl.pathname;
  const dest = destinationFor(!!user, aal?.currentLevel);

  const protectedArea = path.startsWith("/app") || path.startsWith("/admin");
  if (protectedArea && dest !== "ok") return NextResponse.redirect(new URL(dest, request.url));
  if (path === "/mfa" && dest === "/login") return NextResponse.redirect(new URL("/login", request.url));
  return response;
}
