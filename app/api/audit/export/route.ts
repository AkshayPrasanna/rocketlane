import { isAdminRequest } from "@/lib/admin-session";
import { exportFilename, toJsonl } from "@/lib/audit-export";
import { getStore } from "@/lib/store/get-store";

/** The audit log as JSON Lines: everything, or one deal with ?dealId=. Admin only. */
export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dealId = new URL(request.url).searchParams.get("dealId");
  const { audit } = getStore();
  const entries = dealId
    ? await audit.listByDeal(dealId)
    : await audit.listAll();

  return new Response(toJsonl(entries), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${exportFilename(dealId, new Date())}"`,
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}
