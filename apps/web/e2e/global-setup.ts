import { runDbScript } from './environment';

/**
 * Brings the E2E database up to the committed schema before the first test.
 *
 * Only migrations. The demo fixtures cannot be written yet: `db:seed` seeds an
 * existing user and there is no user until somebody signs in, which is the
 * first thing the suite does.
 */
export default function globalSetup(): void {
  runDbScript('db:migrate');
}
