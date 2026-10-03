import {
  PROJECT_MANAGER_ROLE,
  type ResolvedPlan,
} from "@/config/onboarding-plans";
import type { Auditor } from "@/lib/audit";
import { computeSchedule, type Schedule, todayIn } from "@/lib/domain/schedule";
import type { DealRecord, ProjectRef } from "@/lib/domain/schemas";
import { IntegrationError } from "@/lib/integrations/errors";
import type { RocketlaneProject } from "@/lib/integrations/rocketlane/types";
import {
  auditorFor,
  backoffSeconds,
  describeError,
  escalate,
  requireDeal,
} from "./support";
import type { PipelineDeps, ProjectStepResult } from "./types";

function resumeResult(deal: DealRecord): ProjectStepResult | null {
  if (deal.project) {
    return { projectId: deal.project.projectId, status: "created" };
  }
  switch (deal.state) {
    case "DUPLICATE_BLOCKED":
      return { status: "blocked_duplicate" };
    case "ROCKETLANE_FAILED":
    case "ESCALATED_TO_HUMAN":
      return { status: "failed" };
    default:
      return null;
  }
}

function uniqueById(projects: RocketlaneProject[]): RocketlaneProject[] {
  return [...new Map(projects.map((p) => [p.projectId, p])).values()];
}

function sameName(a: string | null, b: string): boolean {
  return a?.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether Rocketlane built the project from the template we meant. Matching the ID only proves
 * Rocketlane did what we asked, so the name it reports must match too: that catches an ID that
 * points at the wrong template (the Enterprise and Growth IDs swapped).
 */
export function isExpectedTemplate(
  project: RocketlaneProject,
  plan: ResolvedPlan
): boolean {
  if (project.templateId !== plan.templateId) {
    return false;
  }
  return project.templateName === null
    ? true
    : sameName(project.templateName, plan.templateName);
}

function describeTemplate(project: RocketlaneProject): string {
  if (project.templateId === null) {
    return "no template reported";
  }
  return `template "${project.templateName ?? "unnamed"}" (${project.templateId})`;
}

/**
 * The dates Rocketlane actually scheduled. A template's durations are in working days, so they
 * differ from the calendar plan; the Slack message and dashboard must show what the project
 * really says. If they cannot be read, the plan is used and the audit log says so.
 */
async function readSchedule(
  deps: PipelineDeps,
  auditor: Auditor,
  projectId: string,
  planned: Schedule
): Promise<Schedule> {
  try {
    const actual = await deps.rocketlane.getSchedule(projectId);
    await auditor.record({
      input: { projectId },
      outcome: "success",
      output: {
        dueDate: actual.dueDate,
        phases: actual.phases.length,
        plannedDueDate: planned.dueDate,
      },
      rationale:
        "Read back the dates Rocketlane scheduled (template durations are in working days) so the Slack message and dashboard match the project.",
      step: "read_schedule",
    });
    return actual;
  } catch (error) {
    if (!(error instanceof IntegrationError)) {
      throw error;
    }
    await auditor.record({
      input: { projectId },
      outcome: "failure",
      output: { error: describeError(error) },
      rationale:
        "Could not read the schedule back from Rocketlane, so the planned dates are used and may differ from the project.",
      step: "read_schedule",
    });
    return planned;
  }
}

/**
 * Fills the template's Project Manager role so the 1-day overdue alert has someone to notify.
 * The project already exists and the rest of onboarding should go on, so a failure here is
 * audited loudly rather than escalated.
 */
async function assignProjectManager(
  deps: PipelineDeps,
  auditor: Auditor,
  projectId: string
): Promise<void> {
  const input = { projectId, roleName: PROJECT_MANAGER_ROLE };
  try {
    const outcome = await deps.rocketlane.assignPlaceholders(projectId, [
      {
        email: deps.settings.rocketlanePmEmail,
        roleName: PROJECT_MANAGER_ROLE,
      },
    ]);
    const filled = outcome.missing.length === 0;
    await auditor.record({
      input,
      outcome: filled ? "success" : "failure",
      output: outcome,
      rationale: filled
        ? "Filled the Project Manager role so the 1-day overdue alert has a recipient."
        : "The project has no fillable Project Manager role, so 1-day overdue alerts have no recipient until a person assigns one.",
      step: "assign_project_manager",
    });
  } catch (error) {
    if (!(error instanceof IntegrationError)) {
      throw error;
    }
    await auditor.record({
      input,
      outcome: "failure",
      output: { error: describeError(error) },
      rationale:
        "Could not fill the Project Manager role. The project was created, so onboarding continues, but a person must assign the Project Manager for overdue alerts to reach anyone.",
      step: "assign_project_manager",
    });
  }
}

export async function createProject(
  deps: PipelineDeps,
  dealId: string,
  attempt: number
): Promise<ProjectStepResult> {
  const deal = await requireDeal(deps, dealId);
  const resumed = resumeResult(deal);
  if (resumed) {
    return resumed;
  }

  const { planTier: tier, parsed } = deal;
  if (!(tier && parsed?.customerName && parsed.opportunityId)) {
    throw new Error(
      `Deal ${dealId} reached project creation without a confirmed tier or validated fields`
    );
  }
  const plan = deps.settings.plans[tier];
  if (plan.tier !== tier) {
    throw new Error(
      `Plan configuration mismatch: tier ${tier} resolved to ${plan.tier}`
    );
  }

  const auditor = auditorFor(deps, deal, "intake");
  const schedule = computeSchedule(
    plan,
    todayIn(deps.clock(), deps.settings.timeZone)
  );
  const projectName = `${parsed.customerName} - ${plan.label} Onboarding`;
  const toRef = (project: RocketlaneProject, actual: Schedule): ProjectRef => ({
    dueDate: actual.dueDate,
    phases: actual.phases,
    projectId: project.projectId,
    projectUrl: project.url,
    startDate: actual.startDate,
    templateId: plan.templateId,
    templateName: plan.templateName,
  });

  try {
    const [byReference, byName] = await Promise.all([
      deps.rocketlane.findProjects({
        externalReferenceId: parsed.opportunityId,
      }),
      deps.rocketlane.findProjects({ nameContains: parsed.customerName }),
    ]);
    const existing = uniqueById([...byReference, ...byName]);

    if (existing.length > 0) {
      // A previous attempt may have created the project and lost the response.
      const [only] = existing;
      const isOurs =
        deal.projectRequestedAt !== null &&
        existing.length === 1 &&
        only.externalReferenceId === parsed.opportunityId &&
        isExpectedTemplate(only, plan);

      if (isOurs) {
        await assignProjectManager(deps, auditor, only.projectId);
        const adoptedSchedule = await readSchedule(
          deps,
          auditor,
          only.projectId,
          schedule
        );
        await deps.store.deals.transitionDeal(dealId, "PROJECT_CREATED", {
          project: toRef(only, adoptedSchedule),
          stateReason: "Adopted the project created by an interrupted attempt",
        });
        await auditor.record({
          input: { attempt, opportunityId: parsed.opportunityId },
          outcome: "success",
          output: { adoptedProjectId: only.projectId },
          rationale:
            "An earlier create call timed out after Rocketlane had already made the project. Adopted it instead of creating a second one.",
          step: "create_project",
        });
        return { projectId: only.projectId, status: "created" };
      }

      await escalate(deps, {
        agent: "intake",
        dealId,
        detail: `Rocketlane already has ${existing.length} matching project(s): ${existing.map((p) => `${p.projectName} (${p.projectId})`).join(", ")}. No new project was created.`,
        input: {
          customerName: parsed.customerName,
          opportunityId: parsed.opportunityId,
        },
        rationale:
          "A project for this customer or opportunity already exists. Creating another would duplicate onboarding, so a human decides.",
        reason: "DUPLICATE_PROJECT",
        step: "create_project",
        toState: "DUPLICATE_BLOCKED",
      });
      return { status: "blocked_duplicate" };
    }

    // Recorded before the call so a retry can tell its own project from a stranger's.
    if (!deal.projectRequestedAt) {
      await deps.store.deals.updateDeal(dealId, {
        projectRequestedAt: deps.clock().toISOString(),
      });
    }

    const project = await deps.rocketlane.createProject({
      customerName: parsed.customerName,
      dueDate: schedule.dueDate,
      externalReferenceId: parsed.opportunityId,
      ownerEmail: deps.settings.rocketlaneOwnerEmail,
      projectName,
      startDate: schedule.startDate,
      templateId: plan.templateId,
    });
    if (!project.projectId) {
      throw new IntegrationError(
        "rocketlane",
        "unknown",
        "Create call did not return a project ID, so success cannot be confirmed"
      );
    }

    if (!isExpectedTemplate(project, plan)) {
      await escalate(deps, {
        agent: "intake",
        dealId,
        detail: `Project ${project.projectId} was created, but Rocketlane reports ${describeTemplate(project)} instead of "${plan.templateName}" (${plan.templateId}). It was left in place and not retried; a human must fix or delete it.`,
        input: {
          expectedTemplateId: plan.templateId,
          projectId: project.projectId,
          reportedTemplateId: project.templateId,
          tier,
        },
        rationale:
          "Using the wrong template is the failure this system exists to prevent, so a project whose template cannot be confirmed is never reported as a success.",
        reason: "TEMPLATE_MISMATCH",
        step: "create_project",
        toState: "ROCKETLANE_FAILED",
      });
      return { status: "failed" };
    }

    await assignProjectManager(deps, auditor, project.projectId);
    const actualSchedule = await readSchedule(
      deps,
      auditor,
      project.projectId,
      schedule
    );
    await deps.store.deals.transitionDeal(dealId, "PROJECT_CREATED", {
      project: toRef(project, actualSchedule),
      stateReason: `Project created from "${plan.templateName}"`,
    });
    await auditor.record({
      input: {
        dueDate: actualSchedule.dueDate,
        projectName,
        startDate: actualSchedule.startDate,
        templateId: plan.templateId,
        templateName: plan.templateName,
        tier,
      },
      outcome: "success",
      output: { projectId: project.projectId, url: project.url },
      rationale: `AE confirmed ${plan.label}, so the ${plan.durationDays}-day template with a ${plan.csm.kind} CSM was used. Success was recorded only after Rocketlane returned a project ID.`,
      step: "create_project",
    });
    return { projectId: project.projectId, status: "created" };
  } catch (error) {
    if (!(error instanceof IntegrationError)) {
      throw error;
    }
    const exhausted = attempt >= deps.settings.retry.maxAttempts;
    if (error.retryable && !exhausted) {
      const delaySeconds = backoffSeconds(
        attempt,
        deps.settings.retry.baseDelaySeconds,
        error.retryAfterMs
      );
      await auditor.record({
        input: { attempt },
        outcome: "retry",
        output: { delaySeconds, error: describeError(error) },
        rationale:
          "Rocketlane returned a retryable error. Backing off and trying again; nothing is marked successful.",
        step: "create_project",
      });
      return { delaySeconds, status: "retry" };
    }

    await escalate(deps, {
      agent: "intake",
      dealId,
      detail: `Rocketlane project creation failed after ${attempt} attempt(s): ${describeError(error)}. Tier ${tier}, opportunity ${parsed.opportunityId}. No project was created.`,
      input: { attempt, tier },
      rationale: error.retryable
        ? "Retries are exhausted. Reporting failure rather than claiming success."
        : "The error is not retryable (for example bad credentials), so retrying would not help.",
      reason: "ROCKETLANE_FAILURE",
      step: "create_project",
      toState: "ROCKETLANE_FAILED",
    });
    return { status: "failed" };
  }
}
