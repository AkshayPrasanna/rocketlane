import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live tests hit real services (the AI Gateway, later Bolna and Rocketlane), so they read the
// same .env.local the app does and are never part of the default `pnpm test`.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the live tests will report which variables are missing.
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/live/**/*.live.test.ts"],
    testTimeout: 120_000,
  },
});
