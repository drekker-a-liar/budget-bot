import { jsonStore } from './jsonStore';
import { pgStore } from './pgStore';
import type { Store } from './store';

/**
 * Which store the API routes talk to.
 *
 * Postgres and the prototype's JSON file run side by side for one step so that
 * the database can be exercised for real - migrations, repositories, seed -
 * before the pages are rewritten to read from it. The JSON file stays the
 * default, so a checkout with no Docker running still works.
 *
 * TEMP: this file, `jsonStore.ts` and `USE_PG` all go away in the sub-project
 * that moves reads into Server Components.
 */
export const db: Store = process.env.USE_PG === '1' ? pgStore : jsonStore;
