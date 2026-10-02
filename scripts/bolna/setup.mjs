/**
 * Applies scripts/bolna/agent-config.mjs to your Bolna agent through Bolna's API.
 *
 *   pnpm bolna:setup
 *
 * Safe to run again: it backs up the agent first, overwrites only the settings listed in the
 * config file, and creates each extraction only if it does not exist yet. Set APP_URL (and
 * BOLNA_WEBHOOK_SECRET) to also point the agent's webhook at the deployed app.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  AGENT_NAME,
  buildWebhookUrl,
  DISPOSITIONS,
  EXTRACTION_CATEGORY,
  SYSTEM_PROMPT,
  TASK_OVERRIDES,
  WELCOME_MESSAGE,
} from "./agent-config.mjs";

const API = process.env.BOLNA_API_BASE ?? "https://api.bolna.ai";
const {
  BOLNA_API_KEY,
  BOLNA_AGENT_ID,
  BOLNA_WEBHOOK_SECRET,
  APP_URL,
  VERCEL_BYPASS,
} = process.env;

if (!(BOLNA_API_KEY && BOLNA_AGENT_ID)) {
  console.error(
    "Set BOLNA_API_KEY and BOLNA_AGENT_ID (for example in .env.local) and try again."
  );
  process.exit(1);
}

async function bolna(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: `Bearer ${BOLNA_API_KEY}`,
      "Content-Type": "application/json",
    },
    method,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { data, ok: response.ok, status: response.status };
}

function describeFailure(label, result) {
  const detail =
    typeof result.data === "string" ? result.data : JSON.stringify(result.data);
  return `${label} failed: HTTP ${result.status} ${detail?.slice(0, 400)}`;
}

function applyTaskOverrides(tasks) {
  const edited = structuredClone(tasks);
  const conversation = edited.find((task) => task.task_type === "conversation");
  if (!conversation) {
    throw new Error("The agent has no conversation task to update.");
  }
  Object.assign(conversation.task_config, TASK_OVERRIDES.taskConfig);
  conversation.tools_config.transcriber.language =
    TASK_OVERRIDES.transcriberLanguage;
  return edited;
}

const agentPath = `/v2/agent/${BOLNA_AGENT_ID}`;

// 1. Read and back up the current agent.
const current = await bolna("GET", agentPath);
if (!current.ok) {
  console.error(describeFailure("Reading the agent", current));
  process.exit(1);
}
mkdirSync(".bolna-backups", { recursive: true });
const backupFile = `.bolna-backups/agent-${BOLNA_AGENT_ID}-${Date.now()}.json`;
writeFileSync(backupFile, JSON.stringify(current.data, null, 2));
console.log(`Backed up the current agent to ${backupFile}`);

// 2. Update the agent: prompt, welcome message, call settings, webhook.
const webhookUrl =
  APP_URL && BOLNA_WEBHOOK_SECRET
    ? buildWebhookUrl(APP_URL, BOLNA_WEBHOOK_SECRET, VERCEL_BYPASS)
    : null;
const promptKey = Object.keys(current.data.agent_prompts ?? {})[0] ?? "task_1";

const agentConfig = {
  agent_name: AGENT_NAME,
  agent_welcome_message: WELCOME_MESSAGE,
  call_summary_enabled: current.data.call_summary_enabled ?? false,
  tasks: applyTaskOverrides(current.data.tasks),
  webhook_url: webhookUrl ?? current.data.webhook_url ?? null,
};
const prompts = { [promptKey]: { system_prompt: SYSTEM_PROMPT } };

const full = await bolna("PUT", agentPath, {
  agent_config: agentConfig,
  agent_prompts: prompts,
});
if (full.ok) {
  console.log(
    "Updated the agent: prompt, welcome message, voicemail detection, English transcription, call limits."
  );
} else {
  console.warn(describeFailure("The full update", full));
  const partial = await bolna("PATCH", agentPath, {
    agent_config: {
      agent_name: AGENT_NAME,
      agent_welcome_message: WELCOME_MESSAGE,
      ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
    },
    agent_prompts: prompts,
  });
  if (!partial.ok) {
    console.error(describeFailure("The partial update", partial));
    process.exit(1);
  }
  console.warn(
    "Updated the prompt, welcome message and webhook only. Set these by hand in the Bolna dashboard:\n" +
      "  - Transcriber tab: language English\n" +
      "  - Call tab: turn Voicemail Detection on"
  );
}

// 3. Create any missing extractions.
/** Bolna answers with { agent_dispositions, global_dispositions }; only the agent's own count. */
function agentDispositions(result) {
  const data = result.data;
  return Array.isArray(data) ? data : (data?.agent_dispositions ?? []);
}

const listed = await bolna("GET", `/dispositions/?agent_id=${BOLNA_AGENT_ID}`);
const existing = new Set(agentDispositions(listed).map((d) => d.name));
for (const disposition of DISPOSITIONS) {
  if (existing.has(disposition.name)) {
    console.log(
      `Extraction "${disposition.name}" already exists; left as it is.`
    );
    continue;
  }
  const created = await bolna("POST", "/dispositions/", {
    agent_id: BOLNA_AGENT_ID,
    category: EXTRACTION_CATEGORY,
    is_objective: true,
    is_subjective: false,
    model: "gpt-4.1-mini",
    name: disposition.name,
    objective_options: disposition.objective_options,
    question: disposition.question,
  });
  console.log(
    created.ok
      ? `Created extraction "${disposition.name}".`
      : describeFailure(`Creating extraction "${disposition.name}"`, created)
  );
}

// 4. Read it back so you can see what is actually set.
const after = await bolna("GET", agentPath);
const task = after.data?.tasks?.find((t) => t.task_type === "conversation");
const afterList = await bolna(
  "GET",
  `/dispositions/?agent_id=${BOLNA_AGENT_ID}`
);
console.log("\nAgent now:");
console.log(`  name:              ${after.data?.agent_name}`);
console.log(`  welcome message:   ${after.data?.agent_welcome_message}`);
console.log(
  `  prompt starts:     ${Object.values(after.data?.agent_prompts ?? {})[0]?.system_prompt?.slice(0, 70)}…`
);
console.log(`  voicemail detect:  ${task?.task_config?.voicemail}`);
console.log(
  `  transcriber lang:  ${task?.tools_config?.transcriber?.language}`
);
console.log(
  `  hang up after:     ${task?.task_config?.hangup_after_silence}s silence / ${task?.task_config?.call_terminate}s total`
);
console.log(
  `  webhook:           ${after.data?.webhook_url ? "set (secret hidden)" : "NOT SET (set APP_URL and BOLNA_WEBHOOK_SECRET, then run again)"}`
);
console.log(
  `  extractions:       ${agentDispositions(afterList)
    .map((d) => d.name)
    .join(", ")}`
);
