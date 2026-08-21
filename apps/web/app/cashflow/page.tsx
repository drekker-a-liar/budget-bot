import { requireOwnerId } from '@/lib/ownerSession';
import { getCashflowPage } from '@/src/server/queries/cashflow';
import { CashFlowView } from './CashFlowView';

/** Liquidity: what came in, what went out, and what is still owed. */
export default async function CashFlowPage() {
  const ownerId = await requireOwnerId();
  const data = await getCashflowPage(ownerId, new Date());

  return <CashFlowView {...data} />;
}
