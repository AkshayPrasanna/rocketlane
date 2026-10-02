import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { config as appConfig } from "./lib/config";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/api/auth/error") {
    const error = request.nextUrl.searchParams.get("error") || "unknown_error";
    return NextResponse.redirect(
      new URL(`/sign-in?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (pathname.startsWith("/api/") || pathname.startsWith("/sign-in")) {
    return NextResponse.next();
  }

  if (appConfig.adminDemoMode) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
