import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import PageContainer from '@/components/layout/page-container';
import { MockupBanner } from '@/features/tracker-mockups/components/mockup-banner';
import { KanbanView } from '@/features/tracker-mockups/components/kanban/kanban-view';

export const metadata = { title: 'Mockup: Kanban + swimlanes' };

export default async function Page() {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  return (
    <PageContainer
      pageTitle='Kanban + swimlanes'
      pageDescription='Status columns with WIP counts. Overdue cards carry a red rule, a red date chip and an explicit days-over count. Toggle the swimlane state to see the same work grouped by person.'
    >
      <MockupBanner />
      <KanbanView />
    </PageContainer>
  );
}
