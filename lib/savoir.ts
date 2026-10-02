import { createLogger } from "./logger";

const logger = createLogger("savoir");

interface BashResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

interface BashBatchResult {
  results: (BashResult & { command: string })[];
  sessionId?: string;
}

const TRAILING_SLASH_RE = /\/$/;

export function createSavoirClient(apiUrl: string, apiKey?: string) {
  const baseUrl = apiUrl.replace(TRAILING_SLASH_RE, "");
  let sessionId: string | undefined;

  async function post<T>(
    path: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, sessionId }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `Savoir API error: ${response.status}`);
    }

    if (data.sessionId) {
      sessionId = data.sessionId;
    }
    return data as T;
  }

  return {
    bash(command: string): Promise<BashResult> {
      logger.debug("Executing bash", { command });
      return post<BashResult>("/api/sandbox/shell", { command });
    },

    bashBatch(commands: string[]): Promise<BashBatchResult> {
      logger.debug("Executing bash batch", { count: commands.length });
      return post<BashBatchResult>("/api/sandbox/shell", { commands });
    },
  };
}
