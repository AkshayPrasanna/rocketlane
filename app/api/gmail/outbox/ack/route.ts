import { authorizeBridge } from "@/lib/gmail-bridge/auth";
import { ackOutbox, ackPayloadSchema } from "@/lib/gmail-bridge/handlers";
import { getPipelineDeps } from "@/lib/pipeline/runtime-deps";

/** The script confirms which replies it has sent, so they are not sent again. */
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
  const payload = ackPayloadSchema.safeParse(body);
  if (!payload.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  await ackOutbox(getPipelineDeps(), payload.data.ids);
  return Response.json({ acked: payload.data.ids.length });
}
