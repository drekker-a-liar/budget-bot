import { runMigrations } from '../src/migrate';
import { loadRootEnv, requireEnv } from './env';

// The same command in every environment, including the Vercel build step, so
// a migration that works locally is the one that runs in production.
loadRootEnv();

const url = requireEnv('DATABASE_URL');
await runMigrations(url);
console.log('Migrations applied.');
