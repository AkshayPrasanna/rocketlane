import { resumeHook } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";
import { getEnv } from "@/lib/env";
import { getPipelineDeps } from "@/lib/pipeline/runtime-deps";
import { handleVoiceWebhook, type ResumeHook } from "@/lib/voice/webhook";

const resumeCallHook: ResumeHook = async (token, payload) => {
  try {
    await resumeHook(token, payload);
    return "resumed";
  } catch (error) {
    // The workflow may not have reached (or may already have finished with) this hook.
    if (HookNotFoundError.is(error)) {
      return "not_waiting";
    }
    throw error;
  }
};

function clientIp(request: Request): string | null {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return forwarded || request.headers.get("x-real-ip");
}

/** Bolna's call-status webhook. Configure its URL as /api/voice/webhook?token=<secret>. */
export async function POST(request: Request) {
  const env = getEnv();

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Leave null; the handler rejects it as an invalid payload after checking the secret.
  }

  const result = await handleVoiceWebhook(
    getPipelineDeps(),
    {
      body,
      clientIp: clientIp(request),
      token: new URL(request.url).searchParams.get("token"),
    },
    { ipCheck: env.bolnaWebhookIpCheck, secret: env.secrets.bolnaWebhook },
    resumeCallHook
  );
  return Response.json(result.body, { status: result.status });
}
