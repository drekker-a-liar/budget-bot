import { defineConfig } from "vitest/config";
import { baseVitestConfig } from "@budget-bot/config/vitest.base.ts";

export default defineConfig({
  ...baseVitestConfig,
  test: {
    ...baseVitestConfig.test,
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Barrel file: re-exports only, nothing to execute.
      exclude: ["src/index.ts"],
    },
  },
});
