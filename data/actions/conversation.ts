"use server";

import { getConversation } from "@/data/queries/activity";
import { requireSession } from "@/data/queries/auth";
import type { ConversationMessage } from "@/lib/types";

export async function fetchConversationPreview(
  actionId: string
): Promise<ConversationMessage[]> {
  await requireSession();
  return getConversation(actionId);
}
