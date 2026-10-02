import { IntegrationError } from "../errors";
import { FaultInjector } from "../fault-injector";
import type {
  CreateProjectInput,
  FindProjectsQuery,
  RocketlaneClient,
  RocketlaneProject,
} from "./types";

export type RocketlaneOp = "createProject" | "findProjects";

/** In-memory Rocketlane. Keeps every create request so tests can assert on the template used. */
export class MockRocketlaneClient implements RocketlaneClient {
  readonly faults = new FaultInjector<RocketlaneOp>("rocketlane");
  readonly projects: RocketlaneProject[] = [];
  readonly createRequests: CreateProjectInput[] = [];
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
    const project: RocketlaneProject = {
      externalReferenceId: input.externalReferenceId,
      projectId: `rl-${this.counter}`,
      projectName: input.projectName,
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
}
