import { createDb } from '../src/client';
import { ownersRepo } from '../src/repos';
import { seedOwner } from '../src/seed';
import { hasFlag, loadRootEnv, readFlag, requireEnv } from './env';

/**
 * Writes the demo fixtures for one existing user.
 *
 *   pnpm --filter @budget-bot/db db:seed --owner-email you@example.com
 *   pnpm --filter @budget-bot/db db:seed --owner-email you@example.com --reset
 *
 * The user has to exist already: Auth.js creates it on first sign-in (ADR
 * 0003), and a row planted here would collide with the OAuth account link
 * rather than save a step. Seeding twice is a no-op unless a reset is asked
 * for, so it is safe to leave in a setup script.
 */
loadRootEnv();

const email = readFlag('owner-email');
if (!email) {
  console.error('Which user should be seeded? Pass --owner-email <email>.');
  process.exit(1);
}

const reset = hasFlag('reset') || process.env.SEED_RESET === '1';
const db = createDb(requireEnv('DATABASE_URL'), { max: 1 });

try {
  const ownerId = await ownersRepo.findOwnerIdByEmail(db, email);
  if (!ownerId) {
    console.error(
      `No user with the email "${email}". Sign in to the app once so Auth.js creates ` +
        'the account, then run this again.'
    );
    process.exit(1);
  }

  const result = await seedOwner(db, ownerId, { reset });
  if (!result.seeded) {
    console.log(
      `${email} already has data; nothing written. Pass --reset to replace it.`
    );
  } else {
    const { projects, transactions, laborEntries, invoices } = result.counts;
    console.log(
      `Seeded ${email}: ${projects} projects, ${transactions} transactions, ` +
        `${laborEntries} labor entries, ${invoices} invoices.`
    );
  }
} finally {
  await db.$client.end();
}
