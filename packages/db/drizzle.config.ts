import { defineConfig } from "drizzle-kit";

/**
 * `generate` only reads the schema; `dbCredentials` matters to the commands
 * that talk to a server, which this project does not use in CI - migrations
 * are applied by scripts/migrate.ts, never by `push`.
 */
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: false,
});
