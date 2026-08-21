import { requireOwnerId } from '@/lib/ownerSession';
import { getConnectionsPage } from '@/src/server/queries/connections';
import { ConnectionsView } from './ConnectionsView';

/**
 * The banks this owner has linked.
 *
 * A Server Component, like every other page: the connections and their
 * accounts are read here, scoped to whoever `auth()` says is asking, and the
 * browser is sent the rendered result. Nothing about a connection - least of
 * all its token, which no read path returns at all - travels as an API
 * response.
 */
export default async function ConnectionsPage() {
  const ownerId = await requireOwnerId();
  const data = await getConnectionsPage(ownerId);

  return <ConnectionsView {...data} />;
}
