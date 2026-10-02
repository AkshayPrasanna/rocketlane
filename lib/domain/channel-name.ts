import type { PlanTier } from "./schemas";

/** Slack allows 80 characters: lowercase letters, digits, hyphens and underscores. */
export const MAX_CHANNEL_NAME_LENGTH = 80;
const PREFIX = "onb-";
const COMBINING_MARKS_RE = /\p{M}/gu;
const NON_ALNUM_RUN_RE = /[^a-z0-9]+/g;
const EDGE_HYPHENS_RE = /^-+|-+$/g;
const SLACK_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;

/** "Acme Corp, Inc." -> "acme-corp-inc". Falls back to "customer" for non-Latin names. */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(COMBINING_MARKS_RE, "")
    .toLowerCase()
    .replace(NON_ALNUM_RUN_RE, "-")
    .replace(EDGE_HYPHENS_RE, "");
  return slug || "customer";
}

/**
 * onb-<customer-slug>-<tier>, with an optional numeric suffix for name collisions.
 * The slug is truncated, never the tier, so the channel always says which plan it is.
 */
export function buildChannelName(
  customerName: string,
  tier: PlanTier,
  collisionIndex = 1
): string {
  const suffix = collisionIndex > 1 ? `-${collisionIndex}` : "";
  const tail = `-${tier}${suffix}`;
  const room = MAX_CHANNEL_NAME_LENGTH - PREFIX.length - tail.length;
  const slug = slugify(customerName).slice(0, Math.max(room, 1));
  return `${PREFIX}${slug.replace(EDGE_HYPHENS_RE, "")}${tail}`;
}

export function isValidChannelName(name: string): boolean {
  return SLACK_NAME_RE.test(name);
}
