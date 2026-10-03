// Clears the app's data from Upstash so a demo starts clean. Dry run unless you pass --yes.
//
//   pnpm demo:reset            shows what would be deleted
//   pnpm demo:reset --yes      deletes it
//
// Only keys starting with "ob:" are touched. The "already processed" markers for Gmail
// messages are kept by default, so an old test email can never be picked up and run again;
// pass --include-message-claims to remove those too.
import { Redis } from "@upstash/redis";

const SCAN_BATCH = 500;
const DELETE_BATCH = 100;
const MESSAGE_CLAIM_PREFIX = "ob:claim:msg:";

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

const confirmed = process.argv.includes("--yes");
const keepMessageClaims = !process.argv.includes("--include-message-claims");
const redis = new Redis({ token, url });

const found = [];
let cursor = "0";
do {
  const [next, batch] = await redis.scan(cursor, {
    count: SCAN_BATCH,
    match: "ob:*",
  });
  cursor = String(next);
  found.push(...batch);
} while (cursor !== "0");

const doomed = found.filter(
  (key) => !(keepMessageClaims && key.startsWith(MESSAGE_CLAIM_PREFIX))
);
const kept = found.length - doomed.length;

const families = new Map();
for (const key of doomed) {
  const family = key.split(":").slice(0, 2).join(":");
  families.set(family, (families.get(family) ?? 0) + 1);
}
console.log(
  `${found.length} app keys found; ${doomed.length} to delete, ${kept} kept.`
);
for (const [family, count] of [...families].sort()) {
  console.log(`  ${family.padEnd(18)} ${count}`);
}

if (!confirmed) {
  console.log("\nDry run. Nothing was deleted. Re-run with --yes to delete.");
  process.exit(0);
}

for (let i = 0; i < doomed.length; i += DELETE_BATCH) {
  await redis.del(...doomed.slice(i, i + DELETE_BATCH));
}
console.log(`\nDeleted ${doomed.length} keys.`);
