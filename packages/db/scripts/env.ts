import { fileURLToPath } from 'node:url';

/**
 * The monorepo keeps one `.env` at its root (see `.env.example`). Node's
 * loader leaves variables that are already set alone, so an explicit
 * `DATABASE_URL=... pnpm db:migrate` still wins.
 */
export function loadRootEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  } catch {
    // No .env checked out - CI and Vercel put the variables in the environment.
  }
}

/** Reads a required variable, or explains which one is missing and stops. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. See .env.example.`);
    process.exit(1);
  }
  return value;
}

/** Reads `--flag value` and `--flag=value` out of argv. */
export function readFlag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  if (index !== -1) return argv[index + 1];
  const inline = argv.find((argument) => argument.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

export function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}
