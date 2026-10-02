import { z } from "zod";

/** Each integration runs against a real service (`live`) or a simulator (`mock`). */
const modeSchema = z.enum(["mock", "live"]).default("mock");

const E164_RE = /^\+[1-9]\d{6,14}$/;
const e164Schema = z
  .string()
  .regex(E164_RE, "must be E.164, e.g. +919876543210");

const positiveInt = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

const envSchema = z.object({
  GMAIL_MODE: modeSchema,
  VOICE_MODE: modeSchema,
  ROCKETLANE_MODE: modeSchema,
  SLACK_MODE: modeSchema,

  AI_MODEL: z.string().min(1).default("anthropic/claude-sonnet-4-20250514"),

  AE_DEMO_PHONE: e164Schema.optional(),
  MAX_CALL_ATTEMPTS: positiveInt(3, 10),
  CALL_RETRY_DELAY_SECONDS: positiveInt(900, 86_400),
  CALL_RESULT_TIMEOUT_SECONDS: positiveInt(600, 3600),

  OPS_SLACK_CHANNEL_ID: z.string().min(1).optional(),

  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  KV_REST_API_URL: z.url().optional(),
  KV_REST_API_TOKEN: z.string().min(1).optional(),
});

export type IntegrationMode = z.infer<typeof modeSchema>;

export interface Env {
  ae: { demoPhone: string | undefined };
  aiModel: string;
  call: {
    maxAttempts: number;
    resultTimeoutSeconds: number;
    retryDelaySeconds: number;
  };
  modes: {
    gmail: IntegrationMode;
    rocketlane: IntegrationMode;
    slack: IntegrationMode;
    voice: IntegrationMode;
  };
  opsSlackChannelId: string | undefined;
  /** Upstash REST credentials (either `UPSTASH_*` or Vercel Marketplace `KV_*`), or null. */
  redis: { token: string; url: string } | null;
}

type EnvSource = Record<string, string | undefined>;

/** Empty strings (`FOO=` in a .env file) count as unset. */
function dropEmpty(source: EnvSource): EnvSource {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value?.trim())
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
    ae: { demoPhone: raw.AE_DEMO_PHONE },
    aiModel: raw.AI_MODEL,
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
    opsSlackChannelId: raw.OPS_SLACK_CHANNEL_ID,
    redis: redisUrl && redisToken ? { token: redisToken, url: redisUrl } : null,
  };
}

let cached: Env | null = null;

/** Lazily parsed so `next build` doesn't fail on missing runtime variables. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
