import { createClient } from "@libsql/client";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { LibsqlDialect } from "kysely-libsql";
import { headers } from "next/headers";
import { config } from "./config";

const dbUrl = process.env.TURSO_DATABASE_URL || "file:local.db";
const dbAuthToken = process.env.TURSO_AUTH_TOKEN;

export const auth = betterAuth({
  database: {
    dialect: new LibsqlDialect({
      url: dbUrl,
      authToken: dbAuthToken,
    }),
    type: "sqlite",
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL:
    process.env.BETTER_AUTH_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000"),
  trustedOrigins: ["http://localhost:3000"],
  emailAndPassword: {
    enabled: process.env.NODE_ENV !== "production",
  },
  socialProviders: {
    slack: {
      clientId: process.env.SLACK_CLIENT_ID || "",
      clientSecret: process.env.SLACK_CLIENT_SECRET || "",
      team: process.env.SLACK_TEAM_ID,
    },
  },
  plugins: [nextCookies()],
});

export async function isCurrentUserLead(): Promise<boolean> {
  if (config.adminDemoMode) {
    return true;
  }

  if (!config.communityLeadSlackId) {
    return false;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return false;
  }

  const db = createClient({ url: dbUrl, authToken: dbAuthToken });
  const result = await db.execute({
    sql: "SELECT accountId FROM account WHERE userId = ? AND providerId = ?",
    args: [session.user.id, "slack"],
  });

  const slackId = result.rows[0]?.accountId as string | undefined;
  return slackId === config.communityLeadSlackId;
}
