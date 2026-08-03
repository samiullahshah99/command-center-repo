import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import PageContainer from '@/components/layout/page-container';
import { MockupBanner } from '@/features/tracker-mockups/components/mockup-banner';
import { TimelineView } from '@/features/tracker-mockups/components/timeline/timeline-view';

export const metadata = { title: 'Mockup: Timeline / roadmap' };

export default async function Page() {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  return (
    <PageContainer
      pageTitle='Timeline / roadmap'
      pageDescription='Due dates on a week grid, grouped by project. The red line is today; overdue bars are extended past their due date to reach it, so lateness reads as distance. Undated work is parked below.'
    >
      <MockupBanner />
      <TimelineView />
    </PageContainer>
  );
}
