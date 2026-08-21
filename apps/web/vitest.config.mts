import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { baseVitestConfig } from "@budget-bot/config/vitest.base.ts";

export default defineConfig({
  ...baseVitestConfig,
  resolve: {
    // Mirror the `@/*` path mapping in tsconfig.json so tests import route
    // handlers exactly the way Next does.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    ...baseVitestConfig.test,
    include: ["test/**/*.test.ts"],
  },
});
