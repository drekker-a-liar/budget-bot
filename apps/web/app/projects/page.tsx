import { requireOwnerId } from '@/lib/ownerSession';
import { getProjectsPage } from '@/src/server/queries/projects';
import { ProjectsView } from './ProjectsView';

/**
 * Every job, with its margin.
 *
 * A Server Component (spec §6): the data is read here, on the server, scoped
 * to whoever `auth()` says is asking, and the browser is sent the rendered
 * result rather than a loading spinner and a fetch. Nothing about the
 * financials leaves the server as an API response any more.
 */
export default async function ProjectsPage() {
  const ownerId = await requireOwnerId();
  const data = await getProjectsPage(ownerId);

  return <ProjectsView {...data} />;
}
