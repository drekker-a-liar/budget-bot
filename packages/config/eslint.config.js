// Minimal shared flat-config base for @budget-bot packages that lint via
// plain `eslint` (packages/*). apps/web is on Next 14, whose `next lint`
// still expects the legacy eslintrc format, so it keeps its own config and
// does not consume this file.
//
// Per-package configs should import this array, spread it, and append a
// `no-restricted-imports` rule that encodes that package's allowed
// dependency direction (see docs/superpowers/specs/.../#3-monorepo:
// config ← core ← {db, bank-connectors, ui} ← web). Example, for a package
// that must never reach into `db` or `ui`:
//
//   import base from "@budget-bot/config/eslint.config.js";
//   export default [
//     ...base,
//     {
//       rules: {
//         "no-restricted-imports": ["error", {
//           patterns: ["@budget-bot/db", "@budget-bot/ui"],
//         }],
//       },
//     },
//   ];
export default [
  {
    ignores: ["dist/**", ".next/**", "node_modules/**"],
  },
];
