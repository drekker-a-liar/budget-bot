import { requireOwnerId } from '@/lib/ownerSession';
import { getDashboardData } from '@/src/server/queries/dashboard';
import { DashboardView } from './DashboardView';

/**
 * The overview.
 *
 * `now` is read once, here, and passed down: every period figure on the page -
 * this week's cash flow, the four-week waterfall - is measured from the same
 * instant rather than from whenever each one happened to be computed.
 */
export default async function HomePage() {
  const ownerId = await requireOwnerId();
  const data = await getDashboardData(ownerId, new Date());

  return <DashboardView {...data} />;
}
