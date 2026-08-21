import { requireOwnerId } from '@/lib/ownerSession';
import { getTransactionsPage } from '@/src/server/queries/transactions';
import { TransactionsView } from './TransactionsView';

/** Every card charge, and the jobs they can be filed against. */
export default async function TransactionsPage() {
  const ownerId = await requireOwnerId();
  const data = await getTransactionsPage(ownerId);

  return <TransactionsView {...data} />;
}
