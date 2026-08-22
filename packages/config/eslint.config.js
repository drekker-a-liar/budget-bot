import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Shared flat-config base for @budget-bot packages that lint with plain
 * `eslint`. apps/web needs eslint-config-next's rule set instead (react,
 * react-hooks, jsx-a11y, @next/next), which it gets via its own
 * eslint.config.mjs and @eslint/eslintrc's FlatCompat rather than this base.
 */
export default [
  {
    ignores: ["dist/**", ".next/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
];

/**
 * Encodes a package's allowed dependency direction as a lint rule. The spec's
 * direction is `config <- core <- {db, bank-connectors, ui} <- web` and nothing
 * imports web; each package spreads the base and appends its own call, naming
 * what it must never reach for.
 *
 *   import base, { restrictImports } from "@budget-bot/config/eslint.config.js";
 *   export default [
 *     ...base,
 *     restrictImports(["@budget-bot/db", "@budget-bot/ui"]),
 *   ];
 *
 * @param {string[]} forbidden Import patterns (gitignore-style globs).
 * @param {string[]} [files] Which files the restriction covers. Defaults to the
 *   package's own source and tests, leaving its config files free to import the
 *   tooling they need.
 */
export function restrictImports(forbidden, files = ["src/**/*.ts", "test/**/*.ts"]) {
  return {
    files,
    rules: {
      // The typescript-eslint version also catches `import type`, which the
      // core rule lets through - and a type-only import is still a dependency.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: forbidden },
      ],
    },
  };
}
