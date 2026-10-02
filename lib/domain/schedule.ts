import type { OnboardingPlan, PhaseName } from "@/config/onboarding-plans";

const MS_PER_DAY = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Today's calendar date (YYYY-MM-DD) in the given IANA time zone. */
export function todayIn(now: Date, timeZone: string): string {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).format(now);
}

/** Adds whole days to a YYYY-MM-DD date. Uses UTC arithmetic so DST can't shift it. */
export function addDays(isoDate: string, days: number): string {
  if (!ISO_DATE_RE.test(isoDate)) {
    throw new Error(`Expected YYYY-MM-DD, got "${isoDate}"`);
  }
  const base = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(base + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** "2026-11-01" -> "1 Nov". */
export function formatShortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

export interface PhaseTarget {
  endDate: string;
  name: PhaseName;
  startDate: string;
}

export interface Schedule {
  dueDate: string;
  phases: PhaseTarget[];
  startDate: string;
}

/** Start is the given date; due date is start plus the plan's duration. */
export function computeSchedule(
  plan: OnboardingPlan,
  startDate: string
): Schedule {
  return {
    dueDate: addDays(startDate, plan.durationDays),
    phases: plan.phases.map((phase) => ({
      endDate: addDays(startDate, phase.endDay),
      name: phase.name,
      startDate: addDays(startDate, phase.startDay),
    })),
    startDate,
  };
}
