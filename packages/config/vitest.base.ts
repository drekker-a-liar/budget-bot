// Shared Vitest config fragment for @budget-bot packages. Kept as a plain
// typed object rather than `defineConfig` so this package doesn't need
// `vitest` as a dependency just to type-check this file. Consumers spread
// this into their own vitest.config.ts and add package-specific options
// (e.g. `test.include`).
export const baseVitestConfig = {
  test: {
    environment: "node",
    globals: false,
  },
} as const;
