import { notFound } from 'next/navigation';
import { requireOwnerId } from '@/lib/ownerSession';
import { getProjectDetail } from '@/src/server/queries/projects';
import { ProjectDetailView } from './ProjectDetailView';

/**
 * One job's ledger.
 *
 * A project that is not this owner's is a 404, exactly like one that does not
 * exist: which of the two it is would be an answer about somebody else's
 * books, and this page has nothing to say about those.
 */
export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const ownerId = await requireOwnerId();
  const data = await getProjectDetail(ownerId, params.id);
  if (!data) notFound();

  return <ProjectDetailView {...data} />;
}
