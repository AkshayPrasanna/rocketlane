import { shouldUseMockActivity } from "@/data/queries/activity-source";
import { getCurrentSession } from "@/data/queries/auth";
import { getActiveStreams, hasActionForThread } from "@/lib/store";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return Response.json([], { status: 401 });
  }
  if (shouldUseMockActivity()) {
    return Response.json([]);
  }

  const streams = await getActiveStreams();
  const results = await Promise.all(
    streams.map(async (s) => ({
      ...s,
      isFollowUp: await hasActionForThread(s.threadId),
    }))
  );
  return Response.json(results);
}
