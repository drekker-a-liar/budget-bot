import { defineConfig } from "vitest/config";
import { baseVitestConfig } from "@budget-bot/config/vitest.base.ts";

export default defineConfig({
  ...baseVitestConfig,
  test: {
    ...baseVitestConfig.test,
    include: ["test/**/*.test.ts"],
  },
});
