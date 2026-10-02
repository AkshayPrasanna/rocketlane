import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Live tests call real services and run only through `pnpm test:live`.
    exclude: [...configDefaults.exclude, "tests/live/**", "tests/workflow/**"],
    restoreMocks: true,
  },
});
