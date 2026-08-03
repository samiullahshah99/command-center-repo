import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import PageContainer from '@/components/layout/page-container';
import { MockupBanner } from '@/features/tracker-mockups/components/mockup-banner';
import { VariantCard } from '@/features/tracker-mockups/components/variant-card';

export const metadata = { title: 'Dashboard: Tracker Mockups' };

export default async function Page() {
  // Resource-based check per CLAUDE.md — src/proxy.ts matches /dashboard(.*),
  // but createRouteMatcher is deprecated and can diverge from Next's routing.
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  return (
    <PageContainer
      pageTitle='Tracker mockups'
      pageDescription='Three static concepts for where the tracker UI goes next. Not wired to anything — these exist to be looked at and argued with.'
    >
      <MockupBanner />

      <div className='grid gap-4 md:grid-cols-3'>
        <VariantCard
          href='/dashboard/tracker-mockups/kanban'
          title='Kanban + swimlanes'
          description='Status columns with WIP counts and escalated overdue cards, plus a per-person swimlane grouping shown as a second state.'
          icon='dashboard'
        />
        <VariantCard
          href='/dashboard/tracker-mockups/timeline'
          title='Timeline / roadmap'
          description='Work as bars on a week grid, grouped by project, with a today-line that overdue items visibly overhang.'
          icon='calendar'
        />
        <VariantCard
          href='/dashboard/tracker-mockups/person'
          title='Person profile + AI summary'
          description='Per-person workload with open, overdue and done counts, and a placeholder AI summary card previewing the summaries ask.'
          icon='employee'
        />
      </div>
    </PageContainer>
  );
}
