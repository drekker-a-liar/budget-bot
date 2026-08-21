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
  // tsconfig.json says `jsx: preserve` because Next does its own transform.
  // Vitest has no Next in front of it, so it needs the runtime transform
  // spelled out here.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    ...baseVitestConfig.test,
    // Node is the default because most of this app is route handlers. The
    // component tests opt into a DOM per file with a `@vitest-environment
    // jsdom` docblock - Vitest 4 removed `environmentMatchGlobs`, and one
    // pragma at the top of a file is more obvious than a glob in this config.
    include: ["test/**/*.test.ts", "**/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
    // Imported stylesheets resolve to an empty module rather than being
    // processed: nothing here asserts on styling.
    css: false,
  },
});
