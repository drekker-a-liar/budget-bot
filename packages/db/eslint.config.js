import base, { restrictImports } from "@budget-bot/config/eslint.config.js";

// packages/db sits one level above core (spec §3): it may reach for the domain
// and for Node, and nothing else. React, Next and the sibling packages are
// above it in the graph, so importing one would invert the dependency
// direction the whole monorepo is arranged to keep acyclic.
export default [
  ...base,
  restrictImports(
    ["react", "next", "next/*", "@budget-bot/ui", "@budget-bot/bank-connectors"],
    ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts"]
  ),
];
