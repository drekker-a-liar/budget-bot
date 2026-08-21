import { loadRootEnv } from '../scripts/env';

// The database tests read DATABASE_URL_TEST out of the monorepo's root .env,
// the same file the db scripts use. Variables already set win, so CI can pass
// its own without a file.
loadRootEnv();
