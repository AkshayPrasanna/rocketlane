// Read-only view of what the pipeline has done, straight from Upstash.
//
//   pnpm demo:status
//
// Prints every deal with its state and the steps in its audit trail. Changes nothing.
import { Redis } from "@upstash/redis";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Credentials may already be in the environment.
}

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
if (!(url && token)) {
  console.error(
    "No Upstash credentials found in .env.local or the environment."
  );
  process.exit(1);
}

const redis = new Redis({ automaticDeserialization: false, token, url });

function read(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const dealIds = await redis.zrange("ob:deals", 0, -1);
if (dealIds.length === 0) {
  console.log("No deals yet.");
}

for (const dealId of dealIds) {
  const deal = read(await redis.get(`ob:deal:${dealId}`));
  const customer = deal?.parsed?.customerName ?? "(not parsed yet)";
  console.log(
    `\n${customer}  [${deal?.state ?? "?"}]  tier=${deal?.planTier ?? "-"}`
  );
  if (deal?.stateReason) {
    console.log(`  reason: ${deal.stateReason}`);
  }
  if (deal?.project) {
    console.log(
      `  project: ${deal.project.projectUrl ?? deal.project.projectId} (${deal.project.templateName})`
    );
  }
  const entries = await redis.lrange(`ob:audit:deal:${dealId}`, 0, -1);
  for (const raw of entries) {
    const entry = read(raw);
    if (entry) {
      const time = String(entry.timestamp ?? "").slice(11, 19);
      console.log(
        `  ${time}  ${String(entry.step).padEnd(24)} ${entry.outcome}`
      );
    }
  }
}

const escalations = await redis.zrange("ob:escalations", 0, -1);
if (escalations.length > 0) {
  console.log(`\n${escalations.length} escalation(s) in the queue.`);
}
