import { IntegrationError } from "../errors";
import { FaultInjector } from "../fault-injector";
import type {
  CreateProjectInput,
  FindProjectsQuery,
  PlaceholderAssignment,
  PlaceholderOutcome,
  RocketlaneClient,
  RocketlaneProject,
} from "./types";

export type RocketlaneOp =
  | "assignPlaceholders"
  | "createProject"
  | "findProjects";

/** In-memory Rocketlane. Keeps every create request so tests can assert on the template used. */
export class MockRocketlaneClient implements RocketlaneClient {
  readonly faults = new FaultInjector<RocketlaneOp>("rocketlane");
  readonly projects: RocketlaneProject[] = [];
  readonly createRequests: CreateProjectInput[] = [];
  readonly assignments: Array<{
    assignments: PlaceholderAssignment[];
    projectId: string;
  }> = [];
  /** Roles the mock's projects do not have, so assigning them is reported as missing. */
  readonly rolesMissingFromTemplate = new Set<string>();
  /** Names Rocketlane would report for template IDs. An unlisted ID reports no name. */
  readonly templateNames = new Map<string, string>();
  /** When set, created projects report this template instead of the one requested. */
  reportedTemplateId: string | null | undefined;
  private counter = 0;
  private lostResponses = 0;

  /** An already-existing project, e.g. one a human created by hand. */
  seed(
    project: Partial<RocketlaneProject> & { projectName: string }
  ): RocketlaneProject {
    this.counter += 1;
    const seeded: RocketlaneProject = {
      externalReferenceId: null,
      projectId: `rl-${this.counter}`,
      templateId: null,
      templateName: null,
      url: `https://mock.rocketlane.test/projects/rl-${this.counter}`,
      ...project,
    };
    this.projects.push(seeded);
    return seeded;
  }

  /**
   * The next N creates succeed on the server but the response is lost (a timeout), the
   * classic way to end up with a project the caller doesn't know about.
   */
  loseNextCreateResponses(count: number): void {
    this.lostResponses = count;
  }

  findProjects(query: FindProjectsQuery): Promise<RocketlaneProject[]> {
    this.faults.check("findProjects");
    const needle = query.nameContains?.trim().toLowerCase();
    return Promise.resolve(
      this.projects.filter((project) => {
        const byReference =
          query.externalReferenceId !== undefined &&
          project.externalReferenceId === query.externalReferenceId;
        const byName =
          needle !== undefined &&
          needle.length > 0 &&
          project.projectName.toLowerCase().includes(needle);
        return byReference || byName;
      })
    );
  }

  createProject(input: CreateProjectInput): Promise<RocketlaneProject> {
    this.faults.check("createProject");
    this.createRequests.push(input);
    this.counter += 1;
    const templateId =
      this.reportedTemplateId === undefined
        ? input.templateId
        : this.reportedTemplateId;
    const project: RocketlaneProject = {
      externalReferenceId: input.externalReferenceId,
      projectId: `rl-${this.counter}`,
      projectName: input.projectName,
      templateId,
      templateName:
        templateId === null
          ? null
          : (this.templateNames.get(templateId) ?? null),
      url: `https://mock.rocketlane.test/projects/rl-${this.counter}`,
    };
    this.projects.push(project);

    if (this.lostResponses > 0) {
      this.lostResponses -= 1;
      return Promise.reject(
        new IntegrationError(
          "rocketlane",
          "timeout",
          "Request timed out waiting for the response"
        )
      );
    }
    return Promise.resolve(project);
  }

  assignPlaceholders(
    projectId: string,
    assignments: PlaceholderAssignment[]
  ): Promise<PlaceholderOutcome> {
    this.faults.check("assignPlaceholders");
    this.assignments.push({ assignments, projectId });
    const outcome: PlaceholderOutcome = { assigned: [], missing: [] };
    for (const { roleName } of assignments) {
      const absent = this.rolesMissingFromTemplate.has(roleName);
      (absent ? outcome.missing : outcome.assigned).push(roleName);
    }
    return Promise.resolve(outcome);
  }
}
