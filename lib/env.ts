import { z } from "zod";

/** Each integration runs against a real service (`live`) or a simulator (`mock`). */
const modeSchema = z.enum(["mock", "live"]).default("mock");

const E164_RE = /^\+[1-9]\d{6,14}$/;
const e164Schema = z
  .string()
  .regex(E164_RE, "must be E.164, e.g. +919876543210");

const timeZoneSchema = z
  .string()
  .default("UTC")
  .refine(
    (zone) => {
      try {
        new Intl.DateTimeFormat("en-CA", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    },
    { message: "must be an IANA time zone, e.g. Asia/Kolkata" }
  );

const positiveInt = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

const envSchema = z.object({
  GMAIL_MODE: modeSchema,
  VOICE_MODE: modeSchema,
  ROCKETLANE_MODE: modeSchema,
  SLACK_MODE: modeSchema,

  AI_MODEL: z.string().min(1).default("google/gemini-2.5-flash"),

  AE_DEMO_EMAIL: z.email().optional(),
  AE_DEMO_NAME: z.string().min(1).optional(),
  AE_DEMO_PHONE: e164Schema.optional(),
  MAX_CALL_ATTEMPTS: positiveInt(3, 10),
  CALL_RETRY_DELAY_SECONDS: positiveInt(900, 86_400),
  CALL_RESULT_TIMEOUT_SECONDS: positiveInt(600, 3600),

  OPS_SLACK_CHANNEL_ID: z.string().min(1).optional(),

  ROCKETLANE_OWNER_EMAIL: z.email().optional(),
  ROCKETLANE_TEMPLATE_ID_ENTERPRISE: z.string().min(1).optional(),
  ROCKETLANE_TEMPLATE_ID_GROWTH: z.string().min(1).optional(),
  ENTERPRISE_CSM_NAME: z.string().min(1).optional(),
  GROWTH_CSM_POOL_NAME: z.string().min(1).optional(),

  ONBOARDING_TIMEZONE: timeZoneSchema,
  APP_URL: z.url().optional(),
  GMAIL_PROCESSED_LABEL: z
    .string()
    .min(1)
    .default("novacrm-onboarding/processed"),
  RETRY_MAX_ATTEMPTS: positiveInt(4, 10),
  RETRY_BASE_DELAY_SECONDS: positiveInt(5, 3600),

  GMAIL_BRIDGE_SECRET: z.string().min(16).optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  BOLNA_WEBHOOK_SECRET: z.string().min(16).optional(),
  BOLNA_WEBHOOK_IP_CHECK: z.enum(["enforce", "off"]).default("enforce"),

  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  KV_REST_API_URL: z.url().optional(),
  KV_REST_API_TOKEN: z.string().min(1).optional(),
});

export type IntegrationMode = z.infer<typeof modeSchema>;

export interface Env {
  ae: {
    demoEmail: string | undefined;
    demoName: string | undefined;
    demoPhone: string | undefined;
  };
  aiModel: string;
  appUrl: string | undefined;
  bolnaWebhookIpCheck: "enforce" | "off";
  call: {
    maxAttempts: number;
    resultTimeoutSeconds: number;
    retryDelaySeconds: number;
  };
  csmNames: { enterprise: string | undefined; growth: string | undefined };
  gmailProcessedLabel: string;
  modes: {
    gmail: IntegrationMode;
    rocketlane: IntegrationMode;
    slack: IntegrationMode;
    voice: IntegrationMode;
  };
  onboardingTimeZone: string;
  opsSlackChannelId: string | undefined;
  /** Upstash REST credentials (either `UPSTASH_*` or Vercel Marketplace `KV_*`), or null. */
  redis: { token: string; url: string } | null;
  retry: { baseDelaySeconds: number; maxAttempts: number };
  rocketlane: {
    ownerEmail: string | undefined;
    templateIds: { enterprise: string | undefined; growth: string | undefined };
  };
  /** Shared secrets for inbound routes. Each route refuses requests when its secret is unset. */
  secrets: {
    adminPassword: string | undefined;
    bolnaWebhook: string | undefined;
    gmailBridge: string | undefined;
  };
}

type EnvSource = Record<string, string | undefined>;

/**
 * Empty strings (`FOO=` in a .env file) count as unset, and surrounding whitespace is dropped.
 * A trailing space or newline pasted into a dashboard field is invisible, so without this a
 * shared secret would silently never match.
 */
function dropEmpty(source: EnvSource): EnvSource {
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, value]) => [key, value?.trim()] as const)
      .filter(([, value]) => value)
  );
}

/** Pure parser so tests can pass an explicit source. Throws one readable error. */
export function parseEnv(source: EnvSource): Env {
  const result = envSchema.safeParse(dropEmpty(source));
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  const raw = result.data;

  const redisUrl = raw.UPSTASH_REDIS_REST_URL ?? raw.KV_REST_API_URL;
  const redisToken = raw.UPSTASH_REDIS_REST_TOKEN ?? raw.KV_REST_API_TOKEN;

  return {
    ae: {
      demoEmail: raw.AE_DEMO_EMAIL,
      demoName: raw.AE_DEMO_NAME,
      demoPhone: raw.AE_DEMO_PHONE,
    },
    aiModel: raw.AI_MODEL,
    appUrl: raw.APP_URL,
    bolnaWebhookIpCheck: raw.BOLNA_WEBHOOK_IP_CHECK,
    csmNames: {
      enterprise: raw.ENTERPRISE_CSM_NAME,
      growth: raw.GROWTH_CSM_POOL_NAME,
    },
    gmailProcessedLabel: raw.GMAIL_PROCESSED_LABEL,
    call: {
      maxAttempts: raw.MAX_CALL_ATTEMPTS,
      resultTimeoutSeconds: raw.CALL_RESULT_TIMEOUT_SECONDS,
      retryDelaySeconds: raw.CALL_RETRY_DELAY_SECONDS,
    },
    modes: {
      gmail: raw.GMAIL_MODE,
      rocketlane: raw.ROCKETLANE_MODE,
      slack: raw.SLACK_MODE,
      voice: raw.VOICE_MODE,
    },
    onboardingTimeZone: raw.ONBOARDING_TIMEZONE,
    opsSlackChannelId: raw.OPS_SLACK_CHANNEL_ID,
    retry: {
      baseDelaySeconds: raw.RETRY_BASE_DELAY_SECONDS,
      maxAttempts: raw.RETRY_MAX_ATTEMPTS,
    },
    rocketlane: {
      ownerEmail: raw.ROCKETLANE_OWNER_EMAIL,
      templateIds: {
        enterprise: raw.ROCKETLANE_TEMPLATE_ID_ENTERPRISE,
        growth: raw.ROCKETLANE_TEMPLATE_ID_GROWTH,
      },
    },
    redis: redisUrl && redisToken ? { token: redisToken, url: redisUrl } : null,
    secrets: {
      adminPassword: raw.ADMIN_PASSWORD,
      bolnaWebhook: raw.BOLNA_WEBHOOK_SECRET,
      gmailBridge: raw.GMAIL_BRIDGE_SECRET,
    },
  };
}

let cached: Env | null = null;

/** Lazily parsed so `next build` doesn't fail on missing runtime variables. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
