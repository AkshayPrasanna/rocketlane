import { z } from "zod";
import { IntegrationError, kindFromStatus } from "../errors";
import type {
  CreateProjectInput,
  FindProjectsQuery,
  PlaceholderAssignment,
  PlaceholderOutcome,
  RocketlaneClient,
  RocketlaneProject,
  RocketlaneSchedule,
} from "./types";

const DEFAULT_BASE_URL = "https://api.rocketlane.com/api/1.0";
const DEFAULT_TIMEOUT_MS = 20_000;
/**
 * Building a project from a template creates every task and took 20-25 seconds against a real
 * account, so it gets far longer than a read.
 */
const CREATE_TIMEOUT_MS = 60_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const MS_PER_SECOND = 1000;
/** Rocketlane sends `X-Retry-After` as epoch milliseconds, which is far above any delay in seconds. */
const EPOCH_MS_THRESHOLD = 100_000_000_000;
const ERROR_BODY_LIMIT = 300;
/** Optional fields the default response leaves out. Comma separated, per Rocketlane. */
const PROJECT_FIELDS = "externalReferenceId,sources";

const idSchema = z.union([z.number(), z.string().min(1)]).transform(String);

const projectSchema = z.looseObject({
  externalReferenceId: z.string().nullish(),
  projectId: idSchema,
  projectName: z.string(),
  sources: z
    .array(
      z.looseObject({
        templateId: idSchema,
        templateName: z.string().nullish(),
      })
    )
    .nullish(),
});
type ProjectPayload = z.infer<typeof projectSchema>;

const projectListSchema = z.looseObject({
  data: z.array(projectSchema).default([]),
  pagination: z
    .looseObject({
      hasMore: z.boolean().nullish(),
      nextPageToken: z.string().nullish(),
    })
    .nullish(),
});

/**
 * What get-placeholders really returns (observed against a live account; the published docs
 * show a different `data` array). A project with no template roles comes back as just
 * `{ projectId }`, hence the default.
 */
const placeholderListSchema = z.looseObject({
  placeholders: z
    .array(
      z.looseObject({
        placeholder: z.looseObject({
          placeholderId: idSchema,
          placeholderName: z.string(),
        }),
        placeholderStatus: z.string().nullish(),
      })
    )
    .default([]),
});

const assignedSchema = z.looseObject({
  placeholders: z
    .array(
      z.looseObject({
        placeholder: z.looseObject({ placeholderId: idSchema }),
        placeholderStatus: z.string().nullish(),
      })
    )
    .nullish(),
});

const scheduleProjectSchema = z.looseObject({
  dueDate: z.string(),
  startDate: z.string(),
});

const phaseListSchema = z.looseObject({
  data: z
    .array(
      z.looseObject({
        dueDate: z.string(),
        phaseName: z.string(),
        startDate: z.string(),
      })
    )
    .default([]),
});

const errorBodySchema = z.looseObject({
  errors: z
    .array(
      z.looseObject({
        errorCode: z.string().nullish(),
        errorMessage: z.string().nullish(),
        field: z.string().nullish(),
      })
    )
    .optional(),
});

type FetchLike = typeof fetch;

export interface RocketlaneApiOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injected in tests. */
  fetchImpl?: FetchLike;
  /** Injected in tests so `X-Retry-After` can be turned into a delay deterministically. */
  now?: () => number;
  /** Where a project opens in the Rocketlane app; `{id}` is replaced by the project ID. */
  projectUrlTemplate?: string;
  timeoutMs?: number;
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string>;
  timeoutMs?: number;
}

function normalise(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/** The live Rocketlane integration. Talks to the public REST API with an `api-key` header. */
export class RocketlaneApiClient implements RocketlaneClient {
  private readonly options: RocketlaneApiOptions;

  constructor(options: RocketlaneApiOptions) {
    this.options = options;
  }

  async createProject(input: CreateProjectInput): Promise<RocketlaneProject> {
    const templateId = Number(input.templateId);
    if (!(Number.isSafeInteger(templateId) && templateId > 0)) {
      throw new IntegrationError(
        "rocketlane",
        "bad_request",
        `Template ID "${input.templateId}" is not a numeric Rocketlane template ID`
      );
    }

    const created = await this.request("POST", "/projects", projectSchema, {
      timeoutMs: CREATE_TIMEOUT_MS,
      body: {
        autoCreateCompany: true,
        customer: { companyName: input.customerName },
        dueDate: input.dueDate,
        externalReferenceId: input.externalReferenceId,
        owner: { emailId: input.ownerEmail },
        projectName: input.projectName,
        sources: [{ startDate: input.startDate, templateId }],
        startDate: input.startDate,
      },
    });

    // The create response should say which template it used. If it does not, ask once more
    // rather than report an unverified template as if it were verified.
    const confirmed =
      created.sources == null
        ? await this.request(
            "GET",
            `/projects/${encodeURIComponent(String(created.projectId))}`,
            projectSchema,
            { query: { includeFields: PROJECT_FIELDS } }
          )
        : created;
    return this.toProject(confirmed);
  }

  async findProjects(query: FindProjectsQuery): Promise<RocketlaneProject[]> {
    const filters: Record<string, string>[] = [];
    if (query.externalReferenceId) {
      filters.push({ "externalReferenceId.eq": query.externalReferenceId });
    }
    const name = query.nameContains?.trim();
    if (name) {
      filters.push({ "projectName.cn": name });
    }

    const found = new Map<string, RocketlaneProject>();
    for (const filter of filters) {
      for (const project of await this.listAll(filter)) {
        found.set(project.projectId, project);
      }
    }
    return [...found.values()];
  }

  async assignPlaceholders(
    projectId: string,
    assignments: PlaceholderAssignment[]
  ): Promise<PlaceholderOutcome> {
    const outcome: PlaceholderOutcome = { assigned: [], missing: [] };
    if (assignments.length === 0) {
      return outcome;
    }
    const base = `/projects/${encodeURIComponent(projectId)}`;

    const { placeholders } = await this.request(
      "POST",
      `${base}/get-placeholders`,
      placeholderListSchema,
      { body: {} }
    );

    const toSend: Array<{
      placeholderId: number;
      roleName: string;
      user: { emailId: string };
    }> = [];
    for (const { email, roleName } of assignments) {
      const wanted = normalise(roleName);
      // A placeholder is named after its role.
      const match = placeholders.find(
        ({ placeholder }) => normalise(placeholder.placeholderName) === wanted
      );
      if (match) {
        toSend.push({
          placeholderId: Number(match.placeholder.placeholderId),
          roleName,
          user: { emailId: email },
        });
      } else {
        outcome.missing.push(roleName);
      }
    }
    if (toSend.length === 0) {
      return outcome;
    }

    const result = await this.request(
      "POST",
      `${base}/assign-placeholders`,
      assignedSchema,
      {
        body: toSend.map(({ placeholderId, user }) => ({
          placeholderId,
          user,
        })),
      }
    );

    for (const sent of toSend) {
      // When Rocketlane echoes the project's placeholders, require ours to be ASSIGNED there.
      const echoed = result.placeholders?.find(
        (entry) =>
          Number(entry.placeholder.placeholderId) === sent.placeholderId
      );
      const confirmed =
        result.placeholders == null ||
        (echoed !== undefined &&
          (echoed.placeholderStatus == null ||
            echoed.placeholderStatus.toUpperCase() === "ASSIGNED"));
      (confirmed ? outcome.assigned : outcome.missing).push(sent.roleName);
    }
    return outcome;
  }

  async getSchedule(projectId: string): Promise<RocketlaneSchedule> {
    const [project, phases] = await Promise.all([
      this.request(
        "GET",
        `/projects/${encodeURIComponent(projectId)}`,
        scheduleProjectSchema
      ),
      // The phases endpoint takes the project as a plain `projectId` parameter.
      this.request("GET", "/phases", phaseListSchema, {
        query: { projectId },
      }),
    ]);
    return {
      dueDate: project.dueDate,
      phases: phases.data
        .map((phase) => ({
          endDate: phase.dueDate,
          name: phase.phaseName,
          startDate: phase.startDate,
        }))
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
      startDate: project.startDate,
    };
  }

  private async listAll(
    filter: Record<string, string>
  ): Promise<RocketlaneProject[]> {
    const projects: RocketlaneProject[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.request("GET", "/projects", projectListSchema, {
        query: {
          ...filter,
          // An archived project for the same customer still counts as a possible duplicate.
          "includeArchive.eq": "true",
          includeFields: PROJECT_FIELDS,
          pageSize: String(PAGE_SIZE),
          ...(pageToken ? { pageToken } : {}),
        },
      });
      projects.push(...result.data.map((item) => this.toProject(item)));
      pageToken = result.pagination?.nextPageToken ?? undefined;
      if (!(result.pagination?.hasMore && pageToken)) {
        break;
      }
    }
    return projects;
  }

  private toProject(payload: ProjectPayload): RocketlaneProject {
    const [source] = payload.sources ?? [];
    return {
      externalReferenceId: payload.externalReferenceId ?? null,
      projectId: payload.projectId,
      projectName: payload.projectName,
      templateId: source?.templateId ?? null,
      templateName: source?.templateName ?? null,
      url: this.options.projectUrlTemplate
        ? this.options.projectUrlTemplate.replace("{id}", payload.projectId)
        : null,
    };
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T>,
    { body, query, timeoutMs: requestTimeoutMs }: RequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.options.baseUrl ?? DEFAULT_BASE_URL;
    const timeoutMs =
      requestTimeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const search = query ? `?${new URLSearchParams(query).toString()}` : "";
    const doFetch = this.options.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}${search}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          Accept: "application/json",
          "api-key": this.options.apiKey,
          "Content-Type": "application/json",
        },
        method,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new IntegrationError(
        "rocketlane",
        timedOut ? "timeout" : "network",
        timedOut
          ? `Rocketlane did not answer ${method} ${path} within ${timeoutMs} ms`
          : `Could not reach Rocketlane for ${method} ${path}`,
        { cause: error }
      );
    }

    if (!response.ok) {
      throw await this.toError(method, path, response);
    }

    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new IntegrationError(
        "rocketlane",
        "unknown",
        `Rocketlane ${method} ${path} returned an unexpected response shape`,
        { status: response.status }
      );
    }
    return parsed.data;
  }

  private async toError(
    method: string,
    path: string,
    response: Response
  ): Promise<IntegrationError> {
    const text = await response.text().catch(() => "");
    let detail = text.slice(0, ERROR_BODY_LIMIT);
    try {
      const body = errorBodySchema.safeParse(JSON.parse(text));
      const messages = body.success
        ? (body.data.errors ?? []).map((entry) =>
            [entry.errorCode, entry.errorMessage, entry.field]
              .filter(Boolean)
              .join(": ")
          )
        : [];
      if (messages.length > 0) {
        detail = messages.join("; ").slice(0, ERROR_BODY_LIMIT);
      }
    } catch {
      // Not JSON; keep the raw text.
    }

    return new IntegrationError(
      "rocketlane",
      kindFromStatus(response.status),
      `Rocketlane ${method} ${path} returned HTTP ${response.status}: ${detail}`,
      { retryAfterMs: this.retryAfterMs(response), status: response.status }
    );
  }

  private retryAfterMs(response: Response): number | undefined {
    const raw = Number(
      response.headers.get("x-retry-after") ??
        response.headers.get("retry-after")
    );
    if (!(Number.isFinite(raw) && raw > 0)) {
      return;
    }
    if (raw > EPOCH_MS_THRESHOLD) {
      return Math.max(0, raw - (this.options.now ?? Date.now)());
    }
    return raw * MS_PER_SECOND;
  }
}
