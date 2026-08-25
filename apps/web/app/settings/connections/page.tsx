import { requireOwnerId } from '@/lib/ownerSession';
import { getConnectionsPage } from '@/src/server/queries/connections';
import { DangerZone } from '../DangerZone';
import { ConnectionsView } from './ConnectionsView';

/**
 * The banks this owner has linked - and, for now, the whole of `/settings`.
 *
 * A Server Component, like every other page: the connections and their
 * accounts are read here, scoped to whoever `auth()` says is asking, and the
 * browser is sent the rendered result. Nothing about a connection - least of
 * all its token, which no read path returns at all - travels as an API
 * response.
 *
 * `DangerZone` (export and delete-all, spec §6) is composed here rather than
 * inside `ConnectionsView`: it needs no props from this page's own read, and
 * a second settings section arriving later is a page this file gains, not a
 * prop `ConnectionsView` has to grow. The wrapper below matches that
 * component's own content width, so the two sections read as one page.
 */
export default async function ConnectionsPage() {
  const ownerId = await requireOwnerId();
  const data = await getConnectionsPage(ownerId);

  return (
    <>
      <ConnectionsView {...data} />
      <div style={{ maxWidth: '1360px', margin: '0 auto', width: '100%', padding: '0 1.5rem 3rem' }}>
        <DangerZone />
      </div>
    </>
  );
}
