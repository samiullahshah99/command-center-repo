import PageContainer from '@/components/layout/page-container';
import ProjectListingPage from '@/features/tracker/components/project-listing';
import { requireRouteAccess } from '@/lib/current-actor';

export const metadata = { title: 'Dashboard: Tracker' };

export default async function Page() {
  // Resource-based check per CLAUDE.md. src/proxy.ts already matches
  // /dashboard(.*), but createRouteMatcher is deprecated and its path matching
  // can diverge from how Next.js routes — this does not rely on it.
  // ⚠️ Role gate + auth in one call. Redirects to the caller's own role home
  // rather than 403ing; the map is @/lib/route-access.
  await requireRouteAccess('/dashboard/tracker');

  return (
    <PageContainer
      pageTitle='Tracker'
      pageDescription='Projects and the work under them. Counts are live: open items, anything past its due date, and action items still waiting on a review decision.'
    >
      <ProjectListingPage />
    </PageContainer>
  );
}
