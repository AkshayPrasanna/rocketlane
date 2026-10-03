import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import { IntegrationError } from "@/lib/integrations/errors";
import { createIntegrations } from "@/lib/integrations/factory";
import { RocketlaneApiClient } from "@/lib/integrations/rocketlane/live";
import { createMemoryStore } from "@/lib/store/get-store";

const API_KEY = "rl-test-key-1234567890";
const BASE = "https://api.test.rocketlane/api/1.0";
const PROJECT_URL = "https://acme.rocketlane.test/projects/{id}";

const INPUT = {
  customerName: "Acme Corp",
  dueDate: "2026-11-01",
  externalReferenceId: "006Ux000001AbCdIAK",
  ownerEmail: "owner@novacrm.io",
  projectName: "Acme Corp - Enterprise Onboarding",
  startDate: "2026-10-02",
  templateId: "5000000300001",
};

interface Reply {
  body?: unknown;
  headers?: Record<string, string>;
  rawBody?: string;
  status?: number;
  throws?: Error;
}

interface Call {
  body: unknown;
  headers: Record<string, string>;
  method: string;
  url: URL;
}

/** A fake fetch that serves replies in order and records every request. */
function fakeFetch(...replies: Reply[]) {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: init.headers as Record<string, string>,
      method: String(init.method),
      url: new URL(url),
    });
    const reply = replies[Math.min(index++, replies.length - 1)];
    if (reply.throws) {
      return Promise.reject(reply.throws);
    }
    return Promise.resolve(
      new Response(reply.rawBody ?? JSON.stringify(reply.body ?? {}), {
        headers: reply.headers,
        status: reply.status ?? 200,
      })
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function client(fetchImpl: typeof fetch, now = () => 1_000_000_000_000) {
  return new RocketlaneApiClient({
    apiKey: API_KEY,
    baseUrl: BASE,
    fetchImpl,
    now,
    projectUrlTemplate: PROJECT_URL,
  });
}

const CREATED = {
  externalReferenceId: INPUT.externalReferenceId,
  projectId: 5_000_000_400_001,
  projectName: INPUT.projectName,
  sources: [
    {
      templateId: 5_000_000_300_001,
      templateName: "NovaCRM Enterprise Onboarding (30d)",
    },
  ],
};

async function failureOf(promise: Promise<unknown>): Promise<IntegrationError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IntegrationError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the call to fail");
}

describe("RocketlaneApiClient.createProject", () => {
  it("builds the project from the template and reports the template it used", async () => {
    const { calls, fetchImpl } = fakeFetch({ body: CREATED, status: 201 });

    const project = await client(fetchImpl).createProject(INPUT);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.method).toBe("POST");
    expect(call.url.href).toBe(`${BASE}/projects`);
    expect(call.headers["api-key"]).toBe(API_KEY);
    expect(call.body).toEqual({
      autoCreateCompany: true,
      customer: { companyName: "Acme Corp" },
      dueDate: "2026-11-01",
      externalReferenceId: "006Ux000001AbCdIAK",
      owner: { emailId: "owner@novacrm.io" },
      projectName: "Acme Corp - Enterprise Onboarding",
      sources: [{ startDate: "2026-10-02", templateId: 5_000_000_300_001 }],
      startDate: "2026-10-02",
    });
    expect(project).toEqual({
      externalReferenceId: "006Ux000001AbCdIAK",
      projectId: "5000000400001",
      projectName: "Acme Corp - Enterprise Onboarding",
      templateId: "5000000300001",
      templateName: "NovaCRM Enterprise Onboarding (30d)",
      url: "https://acme.rocketlane.test/projects/5000000400001",
    });
  });

  it("asks again when the create response does not name the template", async () => {
    const { sources: _omitted, ...withoutSources } = CREATED;
    const { calls, fetchImpl } = fakeFetch(
      { body: withoutSources, status: 201 },
      { body: CREATED }
    );

    const project = await client(fetchImpl).createProject(INPUT);

    expect(calls).toHaveLength(2);
    expect(calls[1].method).toBe("GET");
    expect(calls[1].url.pathname).toBe("/api/1.0/projects/5000000400001");
    expect(calls[1].url.searchParams.get("includeFields")).toBe(
      "externalReferenceId,sources"
    );
    expect(project.templateId).toBe("5000000300001");
  });

  it("reports no template when Rocketlane lists none, so the caller can refuse it", async () => {
    const { fetchImpl } = fakeFetch({
      body: { ...CREATED, sources: [] },
      status: 201,
    });

    const project = await client(fetchImpl).createProject(INPUT);

    expect(project.templateId).toBeNull();
    expect(project.templateName).toBeNull();
  });

  it("leaves the link empty when no URL pattern is configured", async () => {
    const { fetchImpl } = fakeFetch({ body: CREATED, status: 201 });

    const project = await new RocketlaneApiClient({
      apiKey: API_KEY,
      baseUrl: BASE,
      fetchImpl,
    }).createProject(INPUT);

    expect(project.url).toBeNull();
  });

  it("refuses a template ID that is not a Rocketlane number, without calling out", async () => {
    const { calls, fetchImpl } = fakeFetch({ body: CREATED });

    const error = await failureOf(
      client(fetchImpl).createProject({ ...INPUT, templateId: "enterprise" })
    );

    expect(error.kind).toBe("bad_request");
    expect(error.retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("does not report success without a project ID", async () => {
    const { fetchImpl } = fakeFetch({
      body: { projectName: "x", sources: [] },
      status: 201,
    });

    const error = await failureOf(client(fetchImpl).createProject(INPUT));

    expect(error.kind).toBe("unknown");
    expect(error.retryable).toBe(false);
  });
});

describe("RocketlaneApiClient errors", () => {
  it("treats a bad API key as permanent", async () => {
    const { fetchImpl } = fakeFetch({
      body: { errors: [{ errorCode: "UNAUTHORIZED", errorMessage: "No" }] },
      status: 401,
    });

    const error = await failureOf(client(fetchImpl).createProject(INPUT));

    expect(error).toMatchObject({ kind: "unauthorized", status: 401 });
    expect(error.retryable).toBe(false);
  });

  it("quotes Rocketlane's own error message, never the API key", async () => {
    const { fetchImpl } = fakeFetch({
      body: {
        errors: [
          {
            errorCode: "INVALID_FIELD",
            errorMessage: "owner not found",
            field: "owner",
          },
        ],
      },
      status: 400,
    });

    const error = await failureOf(client(fetchImpl).createProject(INPUT));

    expect(error.kind).toBe("bad_request");
    expect(error.message).toContain("INVALID_FIELD: owner not found: owner");
    expect(error.message).not.toContain(API_KEY);
  });

  it("converts the epoch-millisecond X-Retry-After on a 429 into a delay", async () => {
    const { fetchImpl } = fakeFetch({
      headers: { "x-retry-after": String(1_000_000_000_000 + 12_000) },
      status: 429,
    });

    const error = await failureOf(client(fetchImpl).createProject(INPUT));

    expect(error.kind).toBe("rate_limited");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(12_000);
  });

  it("retries 5xx, timeouts and network failures", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const cases = [
      { expected: "server_error", reply: { status: 503 } },
      { expected: "timeout", reply: { throws: timeout } },
      { expected: "network", reply: { throws: new Error("ECONNRESET") } },
    ] as const;

    for (const { expected, reply } of cases) {
      const { fetchImpl } = fakeFetch(reply);
      const error = await failureOf(client(fetchImpl).createProject(INPUT));
      expect(error.kind).toBe(expected);
      expect(error.retryable).toBe(true);
    }
  });
});

describe("RocketlaneApiClient.findProjects", () => {
  const page = (data: unknown[], more?: string) => ({
    body: {
      data,
      pagination: more
        ? { hasMore: true, nextPageToken: more }
        : { hasMore: false },
    },
  });

  it("searches by opportunity ID and by name, including archived projects", async () => {
    const { calls, fetchImpl } = fakeFetch(
      page([CREATED]),
      page([
        {
          projectId: 7,
          projectName: "[Sample] Acme 2 week onboarding",
          sources: [],
        },
      ])
    );

    const found = await client(fetchImpl).findProjects({
      externalReferenceId: INPUT.externalReferenceId,
      nameContains: " Acme ",
    });

    expect(calls).toHaveLength(2);
    const [byReference, byName] = calls.map((call) => call.url.searchParams);
    expect(byReference.get("externalReferenceId.eq")).toBe(
      INPUT.externalReferenceId
    );
    expect(byName.get("projectName.cn")).toBe("Acme");
    for (const params of [byReference, byName]) {
      expect(params.get("includeArchive.eq")).toBe("true");
      expect(params.get("includeFields")).toBe("externalReferenceId,sources");
    }
    expect(found.map((project) => project.projectId)).toEqual([
      "5000000400001",
      "7",
    ]);
    expect(found[0].templateName).toBe("NovaCRM Enterprise Onboarding (30d)");
    expect(found[1].templateId).toBeNull();
  });

  it("returns a project found by both searches once", async () => {
    const { fetchImpl } = fakeFetch(page([CREATED]), page([CREATED]));

    const found = await client(fetchImpl).findProjects({
      externalReferenceId: INPUT.externalReferenceId,
      nameContains: "Acme",
    });

    expect(found).toHaveLength(1);
  });

  it("follows the page token until Rocketlane says there is no more", async () => {
    const second = { projectId: 8, projectName: "Acme second", sources: [] };
    const { calls, fetchImpl } = fakeFetch(
      page([CREATED], "token-1"),
      page([second])
    );

    const found = await client(fetchImpl).findProjects({
      nameContains: "Acme",
    });

    expect(found).toHaveLength(2);
    expect(calls[1].url.searchParams.get("pageToken")).toBe("token-1");
  });

  it("reads an empty result", async () => {
    const { fetchImpl } = fakeFetch({
      body: { data: [], pagination: { hasMore: false, totalRecordCount: 0 } },
    });

    expect(
      await client(fetchImpl).findProjects({ externalReferenceId: "006x" })
    ).toEqual([]);
  });

  it("does not search at all for an empty query", async () => {
    const { calls, fetchImpl } = fakeFetch({ body: { data: [] } });

    expect(
      await client(fetchImpl).findProjects({ nameContains: "  " })
    ).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("surfaces a failed search so a duplicate is never assumed absent", async () => {
    const { fetchImpl } = fakeFetch({ status: 500 });

    const error = await failureOf(
      client(fetchImpl).findProjects({ nameContains: "Acme" })
    );

    expect(error.retryable).toBe(true);
  });
});

describe("RocketlaneApiClient.assignPlaceholders", () => {
  // The shape a live account returns: one entry per template role, named after the role.
  const PLACEHOLDERS = {
    placeholders: [
      {
        placeholder: { placeholderId: 11, placeholderName: "Project Manager" },
        placeholderStatus: "UNASSIGNED",
      },
      {
        placeholder: { placeholderId: 12, placeholderName: "Dedicated CSM" },
        placeholderStatus: "UNASSIGNED",
      },
    ],
    projectId: 55,
  };
  const assigned = (status: string) => ({
    body: {
      placeholders: [
        { placeholder: { placeholderId: 11 }, placeholderStatus: status },
      ],
    },
  });

  it("fills the role by name, whatever the capitalisation", async () => {
    const { calls, fetchImpl } = fakeFetch(
      { body: PLACEHOLDERS },
      assigned("ASSIGNED")
    );

    const outcome = await client(fetchImpl).assignPlaceholders("55", [
      { email: "pm@novacrm.io", roleName: "project manager" },
    ]);

    expect(outcome).toEqual({
      assigned: ["project manager"],
      missing: [],
    });
    expect(calls[0].url.pathname).toBe("/api/1.0/projects/55/get-placeholders");
    expect(calls[1].url.pathname).toBe(
      "/api/1.0/projects/55/assign-placeholders"
    );
    expect(calls[1].body).toEqual([
      { placeholderId: 11, user: { emailId: "pm@novacrm.io" } },
    ]);
  });

  it("reports a role the project does not have, and sends nothing", async () => {
    const { calls, fetchImpl } = fakeFetch({ body: { projectId: 55 } });

    const outcome = await client(fetchImpl).assignPlaceholders("55", [
      { email: "pm@novacrm.io", roleName: "Project Manager" },
    ]);

    expect(outcome).toEqual({ assigned: [], missing: ["Project Manager"] });
    expect(calls).toHaveLength(1);
  });

  it("does not count a placeholder Rocketlane did not mark as assigned", async () => {
    const { fetchImpl } = fakeFetch(
      { body: PLACEHOLDERS },
      assigned("PENDING")
    );

    const outcome = await client(fetchImpl).assignPlaceholders("55", [
      { email: "pm@novacrm.io", roleName: "Project Manager" },
    ]);

    expect(outcome).toEqual({ assigned: [], missing: ["Project Manager"] });
  });

  it("makes no calls when there is nothing to assign", async () => {
    const { calls, fetchImpl } = fakeFetch({ body: PLACEHOLDERS });

    const outcome = await client(fetchImpl).assignPlaceholders("55", []);

    expect(outcome).toEqual({ assigned: [], missing: [] });
    expect(calls).toHaveLength(0);
  });
});

describe("live Rocketlane selection", () => {
  const store = createMemoryStore(() => new Date());
  const options = { clock: () => new Date(), newId: () => "id" };

  it("uses the real client when ROCKETLANE_MODE=live", () => {
    const env = parseEnv({
      ROCKETLANE_API_KEY: API_KEY,
      ROCKETLANE_MODE: "live",
    });

    expect(createIntegrations(env, store, options).rocketlane).toBeInstanceOf(
      RocketlaneApiClient
    );
  });

  it("refuses to start live without an API key", () => {
    expect(() =>
      createIntegrations(parseEnv({ ROCKETLANE_MODE: "live" }), store, options)
    ).toThrow("ROCKETLANE_API_KEY");
  });

  it("requires the project URL pattern to contain {id}", () => {
    expect(() =>
      parseEnv({ ROCKETLANE_PROJECT_URL_TEMPLATE: "https://x.test/projects" })
    ).toThrow("ROCKETLANE_PROJECT_URL_TEMPLATE");
  });
});
