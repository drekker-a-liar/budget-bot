import base, { restrictImports } from "@budget-bot/config/eslint.config.js";

// packages/bank-connectors sits beside db and ui, one level above core (spec
// §3). It is stateless: it turns whatever a bank sends into
// `NormalizedTransaction` and nothing else. It must not reach for the
// database - deciding what to *store* is the application's job, not a
// connector's - nor for a UI framework, nor for a sibling package.
export default [
  ...base,
  {
    files: ["src/**/*.ts"],
    rules: {
      // `CsvProvider` implements methods a file cannot answer, and their
      // parameters are part of the interface it is proving it satisfies.
      // Naming them `_x` is how that is said; deleting them would not compile.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  restrictImports([
    "react",
    "next",
    "next/*",
    "drizzle-orm",
    "@budget-bot/db",
    "@budget-bot/db/*",
    "@budget-bot/ui",
  ]),
];
