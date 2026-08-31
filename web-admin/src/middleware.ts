import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap early rejection. **Not** the security boundary.
 *
 * Everything that decides who may do what lives in `src/lib/authz.ts`, inside
 * the request, where it can reach the database. Three reasons it is not here:
 *
 *   1. Next.js middleware has been bypassable at the framework level -
 *      CVE-2025-29927 let a crafted header skip it entirely. A control that a
 *      header can turn off is not a control.
 *   2. Middleware runs before the route is known, so it cannot know which
 *      permission the request needs.
 *   3. It cannot re-read `account_access`, which is the whole point of the
 *      session design: a demotion must take effect on the next click.
 *
 * So this does one thing that is safe to get wrong: it sends anonymous
 * requests to the sign-in page without touching the database. If it were
 * bypassed entirely, every route would still be checked by the guard.
 */
const PUBLIC_PATHS = ["/login", "/_next", "/favicon.ico", "/api/health"];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const response = PUBLIC_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    ? NextResponse.next()
    : hasSessionCookie(request)
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/login?reason=none", request.url));

  // Belt and braces with next.config.ts, which sets the same headers. If a
  // future route opts out of the config's matcher, it still gets these.
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function hasSessionCookie(request: NextRequest): boolean {
  return Boolean(
    request.cookies.get("__Host-ash_admin")?.value || request.cookies.get("ash_admin_session")?.value,
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
