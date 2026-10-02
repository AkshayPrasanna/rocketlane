import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, readCookie, verifySessionToken } from "@/lib/admin-auth";
import { config } from "@/lib/config";
import { getEnv } from "@/lib/env";

/** True for a signed-in admin, or for everyone when the demo bypass is on. */
export async function isAdminSession(): Promise<boolean> {
  if (config.adminDemoMode) {
    return true;
  }
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return await verifySessionToken(
    token,
    getEnv().secrets.adminPassword,
    Date.now()
  );
}

/** Every page and server action re-checks this itself; the proxy is only a first gate. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdminSession())) {
    redirect("/login");
  }
}

/** For route handlers, which receive the raw request. */
export async function isAdminRequest(request: Request): Promise<boolean> {
  if (config.adminDemoMode) {
    return true;
  }
  const token = readCookie(request.headers.get("cookie"), ADMIN_COOKIE);
  return await verifySessionToken(
    token,
    getEnv().secrets.adminPassword,
    Date.now()
  );
}

export async function currentOrigin(): Promise<string> {
  const list = await headers();
  return `${list.get("x-forwarded-proto") ?? "https"}://${list.get("host") ?? ""}`;
}
