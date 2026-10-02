export interface RocketlaneProject {
  externalReferenceId: string | null;
  projectId: string;
  projectName: string;
  /** The template Rocketlane says the project was built from. Null when it does not say. */
  templateId: string | null;
  templateName: string | null;
  /** Link to the project in the Rocketlane app, when it can be derived. */
  url: string | null;
}

export interface CreateProjectInput {
  customerName: string;
  dueDate: string;
  /** The Salesforce opportunity ID. Lets us find this project again for duplicate checks. */
  externalReferenceId: string;
  ownerEmail: string;
  projectName: string;
  startDate: string;
  templateId: string;
}

export interface FindProjectsQuery {
  externalReferenceId?: string;
  /** Case-insensitive substring match on the project name. */
  nameContains?: string;
}

/** Fill a template role (a Rocketlane "placeholder") with a real user. */
export interface PlaceholderAssignment {
  email: string;
  roleName: string;
}

export interface PlaceholderOutcome {
  /** Role names that now have the requested person. */
  assigned: string[];
  /** Role names that could not be filled, e.g. the template has no such role. */
  missing: string[];
}

export interface RocketlaneClient {
  /** Roles are matched by name. A role the project does not have is reported as missing. */
  assignPlaceholders(
    projectId: string,
    assignments: PlaceholderAssignment[]
  ): Promise<PlaceholderOutcome>;
  /**
   * Resolves only on a confirmed create with a project ID; every failure throws
   * IntegrationError. The result reports the template Rocketlane actually used, so the caller
   * can check it rather than trust the request.
   */
  createProject(input: CreateProjectInput): Promise<RocketlaneProject>;
  findProjects(query: FindProjectsQuery): Promise<RocketlaneProject[]>;
}
