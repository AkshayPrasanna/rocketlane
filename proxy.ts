import { type NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "./lib/admin-auth";
import { config as appConfig } from "./lib/config";
import { getEnv } from "./lib/env";

/**
 * The first gate for dashboard pages. API routes authenticate themselves (shared secrets or
 * the admin cookie), and the workflow runtime's own routes are authenticated by the runtime,
 * so neither may be redirected to the login page.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/.well-known/workflow/") ||
    pathname.startsWith("/login")
  ) {
    return NextResponse.next();
  }

  if (appConfig.adminDemoMode) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  const signedIn = await verifySessionToken(
    token,
    getEnv().secrets.adminPassword,
    Date.now()
  );
  if (!signedIn) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
