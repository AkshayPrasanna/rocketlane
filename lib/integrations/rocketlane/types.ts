export interface RocketlaneProject {
  externalReferenceId: string | null;
  projectId: string;
  projectName: string;
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
  projectName?: string;
}

export interface RocketlaneClient {
  /** Resolves only on a confirmed 201 with a project ID; every failure throws IntegrationError. */
  createProject(input: CreateProjectInput): Promise<RocketlaneProject>;
  findProjects(query: FindProjectsQuery): Promise<RocketlaneProject[]>;
}
