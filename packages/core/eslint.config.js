import base, { restrictImports } from "@budget-bot/config/eslint.config.js";

// packages/core is the bottom of the dependency graph (spec §3): pure domain
// logic, zod its only dependency. It must not reach for a UI framework, the
// database layer, a sibling package, or the Node runtime - anything it cannot
// import is something it cannot accidentally become responsible for.
export default [
  ...base,
  restrictImports([
    "react",
    "next",
    "next/*",
    "drizzle-orm",
    "@budget-bot/*",
    "node:*",
    "fs",
    "path",
  ]),
];
