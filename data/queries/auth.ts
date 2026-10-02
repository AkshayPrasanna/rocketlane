import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { config } from "@/lib/config";

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

const DEMO_SESSION_CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
const DEMO_SESSION_EXPIRES_AT = new Date("2099-01-01T00:00:00.000Z");

function getDemoSession(): AuthSession {
  const demo: AuthSession = {
    session: {
      id: "demo-session",
      token: "demo-session-token",
      userId: "demo-user",
      expiresAt: DEMO_SESSION_EXPIRES_AT,
      createdAt: DEMO_SESSION_CREATED_AT,
      updatedAt: DEMO_SESSION_CREATED_AT,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: "demo-user",
      name: "Demo Reviewer",
      email: "demo@example.com",
      emailVerified: true,
      image: null,
      createdAt: DEMO_SESSION_CREATED_AT,
      updatedAt: DEMO_SESSION_CREATED_AT,
    },
  };
  return demo;
}

export const getCurrentSession = cache(
  async (): Promise<AuthSession | null> => {
    if (config.adminDemoMode) {
      await connection();
      return getDemoSession();
    }

    return auth.api.getSession({ headers: await headers() });
  }
);

export const requireSession = cache(async () => {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/sign-in");
  }
  return session;
});
