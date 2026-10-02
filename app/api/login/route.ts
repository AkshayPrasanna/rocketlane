import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  createSessionToken,
  passwordMatches,
  SESSION_SECONDS,
} from "@/lib/admin-auth";
import { getEnv } from "@/lib/env";

const FAILED_LOGIN_DELAY_MS = 700;

/** A plain form post, so sign-in works without JavaScript and can be tested with curl. */
export async function POST(request: Request) {
  const expected = getEnv().secrets.adminPassword;
  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, request.url), 303);

  if (!expected) {
    return redirectTo("/login?error=unconfigured");
  }

  const form = await request.formData().catch(() => null);
  const password = form?.get("password");
  if (
    typeof password !== "string" ||
    !(await passwordMatches(password, expected))
  ) {
    // A small delay makes guessing passwords slow.
    await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
    return redirectTo("/login?error=invalid");
  }

  const response = redirectTo("/");
  response.cookies.set(
    ADMIN_COOKIE,
    await createSessionToken(expected, Date.now()),
    {
      httpOnly: true,
      maxAge: SESSION_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    }
  );
  return response;
}
