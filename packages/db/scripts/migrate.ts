import { runMigrations } from '../src/migrate';
import { loadRootEnv, requireEnv } from './env';

// The same command locally and in the Vercel Production build step, so a
// migration that works on a laptop is the one that runs in production. It is
// the build command (`apps/web/vercel.json`) that decides *whether* to run it:
// only when `VERCEL_ENV` is `production`. A preview deployment has no
// `DATABASE_URL` of its own (the deploy guide scopes every secret to
// Production), and a migrate step that exits 1 there fails every pull
// request's build; a preview that *did* inherit the production URL would be
// worse, migrating the live database ahead of the code that needs it.
loadRootEnv();

const url = requireEnv('DATABASE_URL');
await runMigrations(url);
console.log('Migrations applied.');
