import type { BankProvider } from '@budget-bot/bank-connectors';
import { PlaidProvider, createPlaidClient } from '@budget-bot/bank-connectors';
import { isE2eSignInEnabled } from '@/lib/e2eProvider';
import type { RawEnv } from '@/src/env';
import { FakeBankProvider, defaultFakeScript } from './fake-provider';

/**
 * Which bank this deployment is talking to, decided once from the environment.
 *
 * Three answers, and `null` is a real one. A deployment with no Plaid
 * credentials is a supported deployment - the connections screen says Plaid is
 * not configured rather than throwing (spec §7) - so the factory returns
 * nothing rather than half a provider or an exception at import time.
 *
 * The `E2E=1` door wins over credentials when both are present. That is not a
 * hazard: the door cannot open in production (`assertProductionSecurity`
 * refuses to boot with `E2E` set), and the constructor refuses a second time
 * (`fake-provider.ts`). What it buys is that an end-to-end run on a developer
 * machine that *does* have Sandbox credentials in its `.env` still gets the
 * scripted bank, rather than quietly making real Plaid calls.
 */

export type BankProviderKind = 'fake' | 'plaid';

export function getBankProviderKind(raw: RawEnv = process.env): BankProviderKind | null {
  if (isE2eSignInEnabled(raw)) return 'fake';
  // Both, or neither. One alone configures nothing, and building a client from
  // half a credential pair would turn a misconfiguration into a 400 from Plaid
  // on the first Link attempt instead of a "not configured" screen.
  if (raw.PLAID_CLIENT_ID && raw.PLAID_SECRET) return 'plaid';
  return null;
}

/**
 * The Plaid provider, built once.
 *
 * Cached against the environment object it was built from, by identity. The
 * application only ever passes `process.env`, which is one object for the life
 * of the process, so that is "once"; a test passing its own object gets its
 * own client and can never be served one built for another environment.
 *
 * Deliberately *not* keyed on the credentials: a module-level map whose keys
 * are secrets is a thing to avoid having, and identity gives the same answer
 * without one.
 */
let cached: { raw: RawEnv; provider: PlaidProvider } | null = null;

function plaidProvider(raw: RawEnv): PlaidProvider {
  if (cached?.raw === raw) return cached.provider;

  const provider = new PlaidProvider({
    client: createPlaidClient({
      clientId: raw.PLAID_CLIENT_ID as string,
      secret: raw.PLAID_SECRET as string,
      // `sandbox` unless the environment says otherwise. Safe as a default
      // only because `assertProductionSecurity` refuses a production
      // deployment that has credentials without `PLAID_ENV=production`, so
      // this branch cannot be reached in production with the wrong answer.
      env: raw.PLAID_ENV === 'production' ? 'production' : 'sandbox',
    }),
  });

  cached = { raw, provider };
  return provider;
}

export function getBankProvider(raw: RawEnv = process.env): BankProvider | null {
  switch (getBankProviderKind(raw)) {
    case 'fake':
      return new FakeBankProvider(defaultFakeScript(), raw);
    case 'plaid':
      return plaidProvider(raw);
    default:
      return null;
  }
}
