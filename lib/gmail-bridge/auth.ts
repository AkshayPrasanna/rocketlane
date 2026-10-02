import { getEnv } from "@/lib/env";
import { checkSharedSecret, failureResponse } from "@/lib/http/auth";

export const BRIDGE_SECRET_HEADER = "x-bridge-secret";

/** Returns a response to send back if the caller is not the Gmail bridge script, else null. */
export function authorizeBridge(request: Request): Response | null {
  const failure = checkSharedSecret(
    request.headers.get(BRIDGE_SECRET_HEADER),
    getEnv().secrets.gmailBridge
  );
  return failure ? failureResponse(failure) : null;
}
