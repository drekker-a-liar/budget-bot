import { requireOwnerId } from '@/lib/ownerSession';
import { getMonthlyMargins } from '@/src/server/queries/margin';
import { MarginView } from './MarginView';

/** Profitability: trailing-12-month gross margin, cash basis (spec §4). */
export default async function MarginPage() {
  const ownerId = await requireOwnerId();
  const data = await getMonthlyMargins(ownerId);

  return <MarginView {...data} />;
}
