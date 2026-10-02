function isEnabled(value: string | undefined): boolean {
  return value
    ? ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
    : false;
}

/**
 * UI-level settings read by the admin panel and proxy. Pipeline settings
 * (integration modes, call retries, secrets) live in `lib/env.ts`.
 */
export const config = {
  /** Bypasses admin sign-in only; deal data is always read from the real store. */
  adminDemoMode:
    isEnabled(process.env.ADMIN_DEMO_MODE) &&
    isEnabled(process.env.ALLOW_ADMIN_DEMO_MODE),
  appName: process.env.APP_NAME || "NovaCRM Onboarding",
  slackWorkspaceUrl: process.env.SLACK_WORKSPACE_URL || "",
};
