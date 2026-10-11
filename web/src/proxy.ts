import { NextResponse, type NextRequest } from "next/server";

const ADMIN_COOKIE = "admin_token";
const LOGIN_PATH = "/admin/login";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === LOGIN_PATH) return NextResponse.next();

  if (!request.cookies.has(ADMIN_COOKIE)) {
    return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
