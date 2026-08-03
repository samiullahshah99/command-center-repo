import PageContainer from '@/components/layout/page-container';
import ProjectListingPage from '@/features/tracker/components/project-listing';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Dashboard: Tracker' };

export default async function Page() {
  // Resource-based check per CLAUDE.md. src/proxy.ts already matches
  // /dashboard(.*), but createRouteMatcher is deprecated and its path matching
  // can diverge from how Next.js routes — this does not rely on it.
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  return (
    <PageContainer
      pageTitle='Tracker'
      pageDescription='Projects and the work under them. Counts are live: open items, anything past its due date, and action items still waiting on a review decision.'
    >
      <ProjectListingPage />
    </PageContainer>
  );
}
