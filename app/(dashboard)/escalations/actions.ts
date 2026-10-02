"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-session";
import { resolveEscalation } from "@/lib/dashboard/resolve";
import { getStore } from "@/lib/store/get-store";

export async function resolveEscalationAction(
  formData: FormData
): Promise<void> {
  // Server actions can be called directly, so the check lives here, not just on the page.
  await requireAdmin();
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    return;
  }
  await resolveEscalation(getStore(), id, "dashboard admin", {
    clock: () => new Date(),
    newId: () => crypto.randomUUID(),
  });
  revalidatePath("/escalations");
}
