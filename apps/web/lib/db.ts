import { jsonStore } from './jsonStore';
import { createPgStore } from './pgStore';
import type { Store } from './store';

/**
 * Which store the API routes talk to, and whose data it reads.
 *
 * Postgres and the prototype's JSON file run side by side for one step so that
 * the database can be exercised for real - migrations, repositories, seed -
 * before the pages are rewritten to read from it. The JSON file stays the
 * default, so a checkout with no Docker running still works; it holds a single
 * unscoped copy of the books and ignores the owner entirely, which is why
 * `assertProductionSecurity` refuses to let it run in production.
 *
 * TEMP: this file, `jsonStore.ts` and `USE_PG` all go away in the sub-project
 * that moves reads into Server Components.
 */
export function storeFor(ownerId: string): Store {
  return process.env.USE_PG === '1' ? createPgStore(ownerId) : jsonStore;
}
