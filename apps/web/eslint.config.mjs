import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// apps/web is the only workspace still needing eslint-config-next's rule set
// (react, react-hooks, jsx-a11y, @next/next); flat config dropped `extends`,
// so FlatCompat replays that legacy preset - unchanged from the old
// .eslintrc.json, which named only `next/core-web-vitals` - into flat
// config's array form. See packages/config/eslint.config.js for the flat
// base every other workspace uses instead.
export default [
  ...compat.extends("next/core-web-vitals"),
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
];
