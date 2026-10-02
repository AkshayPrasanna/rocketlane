import { authorizeBridge } from "@/lib/gmail-bridge/auth";
import { listOutbox } from "@/lib/gmail-bridge/handlers";
import { getPipelineDeps } from "@/lib/pipeline/runtime-deps";

/** The replies the Gmail bridge script should send from the CS inbox. */
export async function GET(request: Request) {
  const denied = authorizeBridge(request);
  if (denied) {
    return denied;
  }
  const replies = await listOutbox(getPipelineDeps());
  return Response.json({ replies });
}
