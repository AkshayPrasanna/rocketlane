import { getEnv } from "@/lib/env";
import { authorizeBridge } from "@/lib/gmail-bridge/auth";
import { getPipelineDeps } from "@/lib/pipeline/runtime-deps";

/**
 * Says whether this deployment's configuration is usable, and if not, which variable is wrong.
 * It builds the same dependency graph every route uses, so it fails exactly when they would.
 * Guarded by the Gmail bridge secret. Configuration errors name variables, never their values.
 */
export function GET(request: Request) {
  const denied = authorizeBridge(request);
  if (denied) {
    return denied;
  }

  const { modes } = getEnv();
  try {
    getPipelineDeps();
    return Response.json({ modes, ok: true });
  } catch (error) {
    return Response.json(
      {
        modes,
        ok: false,
        problem: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
