import { NextRequest, NextResponse } from "next/server";

/**
 * Minimal founder-only gate for /admin. Deliberately simple for a
 * validation-stage product (single shared secret via APP_SECRET, no user
 * accounts) - replace with real admin auth before this needs to support more
 * than one operator.
 */
export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/admin")) return NextResponse.next();
  if (request.nextUrl.pathname === "/admin/login") return NextResponse.next();

  const cookie = request.cookies.get("admin_auth")?.value;
  if (cookie && cookie === process.env.APP_SECRET) return NextResponse.next();

  const loginUrl = new URL("/admin/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = { matcher: ["/admin/:path*"] };
