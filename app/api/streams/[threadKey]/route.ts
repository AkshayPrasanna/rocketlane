import { shouldUseMockActivity } from "@/data/queries/activity-source";
import { getCurrentSession } from "@/data/queries/auth";
import { getStreamByThreadKey } from "@/lib/store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ threadKey: string }> }
) {
  const session = await getCurrentSession();
  if (!session) {
    return Response.json(null, { status: 401 });
  }
  if (shouldUseMockActivity()) {
    return Response.json(null);
  }

  const { threadKey } = await params;
  const stream = await getStreamByThreadKey(threadKey);
  return Response.json(stream);
}
