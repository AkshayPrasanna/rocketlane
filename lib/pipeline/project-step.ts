import { computeSchedule, todayIn } from "@/lib/domain/schedule";
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
  const toRef = (project: RocketlaneProject): ProjectRef => ({
    dueDate: schedule.dueDate,
    projectId: project.projectId,
    projectUrl: project.url,
    startDate: schedule.startDate,
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
        only.externalReferenceId === parsed.opportunityId;

      if (isOurs) {
        await deps.store.deals.transitionDeal(dealId, "PROJECT_CREATED", {
          project: toRef(only),
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

    await deps.store.deals.transitionDeal(dealId, "PROJECT_CREATED", {
      project: toRef(project),
      stateReason: `Project created from "${plan.templateName}"`,
    });
    await auditor.record({
      input: {
        dueDate: schedule.dueDate,
        projectName,
        startDate: schedule.startDate,
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
