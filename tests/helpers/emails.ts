export const AE = {
  email: "ravi.kumar@novacrm.io",
  name: "Ravi Kumar",
  // A reserved, non-routable US test number. Never a real person's phone.
  phone: "+15555550100",
};

export const OPPORTUNITY_ID = "006Ux000001AbCdIAK";
export const OPPORTUNITY_URL = `https://novacrm.lightning.force.com/lightning/r/Opportunity/${OPPORTUNITY_ID}/view`;

export interface DealEmailFields {
  /** Pass null to leave the line out entirely. */
  aeName: string | null;
  contactEmail: string | null;
  contactName: string | null;
  customer: string | null;
  /** Extra free text appended to the body, e.g. an injection attempt. */
  extra: string[];
  opportunityUrl: string | null;
}

const DEFAULTS: DealEmailFields = {
  aeName: AE.name,
  contactEmail: "jane.doe@acme.com",
  contactName: "Jane Doe",
  customer: "Acme Corp",
  extra: [],
  opportunityUrl: OPPORTUNITY_URL,
};

/** A well-formed deal notification. Override or null out fields to break it. */
export function dealEmail(overrides: Partial<DealEmailFields> = {}) {
  const fields = { ...DEFAULTS, ...overrides };
  const lines = [
    "Hi CS team,",
    "",
    "Great news, a new deal just closed!",
    "",
    fields.customer === null ? null : `Customer: ${fields.customer}`,
    fields.contactName === null ? null : `Contact name: ${fields.contactName}`,
    fields.contactEmail === null
      ? null
      : `Contact email: ${fields.contactEmail}`,
    fields.opportunityUrl === null
      ? null
      : `Opportunity: ${fields.opportunityUrl}`,
    fields.aeName === null ? null : `AE: ${fields.aeName}`,
    ...fields.extra,
    "",
    "Thanks!",
  ];
  return {
    bodyText: lines.filter((line): line is string => line !== null).join("\n"),
    subject: `Deal closed: ${fields.customer ?? "(unnamed)"}`,
  };
}
