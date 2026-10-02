import { start } from "workflow/api";
import { authorizeBridge } from "@/lib/gmail-bridge/auth";
import { handleIngest, ingestPayloadSchema } from "@/lib/gmail-bridge/handlers";
import { getPipelineDeps } from "@/lib/pipeline/runtime-deps";
import { onboardingWorkflow } from "@/workflows/onboarding";

async function startOnboarding(dealId: string): Promise<string> {
  const run = await start(onboardingWorkflow, [{ dealId }]);
  return run.runId;
}

/** Called by the Gmail bridge script with the new deal emails it found. */
export async function POST(request: Request) {
  const denied = authorizeBridge(request);
  if (denied) {
    return denied;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const payload = ingestPayloadSchema.safeParse(body);
  if (!payload.success) {
    return Response.json(
      { error: "Invalid payload", issues: payload.error.issues.length },
      { status: 400 }
    );
  }

  const results = await handleIngest(
    getPipelineDeps(),
    payload.data.messages,
    startOnboarding
  );
  return Response.json({ results });
}
