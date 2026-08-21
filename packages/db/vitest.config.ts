import { defineConfig } from "vitest/config";
import { baseVitestConfig } from "@budget-bot/config/vitest.base.ts";

export default defineConfig({
  ...baseVitestConfig,
  test: {
    ...baseVitestConfig.test,
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // Every database test shares one Postgres database and truncates between
    // cases, so two files running at once would delete each other's rows.
    fileParallelism: false,
    // The migration test drops and rebuilds the public schema; a retry would
    // hide a genuinely non-idempotent migration.
    retry: 0,
  },
});
