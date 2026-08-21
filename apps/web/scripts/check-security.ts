import { fileURLToPath } from 'node:url';
import { assertProductionSecurity, type RawEnv } from '../src/env';

/**
 * `pnpm check:security`: the boot assertion, run on purpose rather than by
 * accident at 3am on a deploy.
 *
 * `NODE_ENV` is forced to production because the point is to judge the
 * variables a production deployment would get - run it against the output of
 * `vercel env pull --environment=production`, or against a shell that has the
 * same variables exported.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // No .env checked out; CI and `vercel env pull` put them in the environment.
}

const environment: RawEnv = { ...process.env, NODE_ENV: 'production' };

try {
  assertProductionSecurity(environment);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

console.log('Security check passed: this environment is safe to deploy to production.');
