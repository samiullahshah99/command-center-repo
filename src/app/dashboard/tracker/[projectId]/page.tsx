import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import PageContainer from '@/components/layout/page-container';
import BoardViewPage from '@/features/tracker/components/board-view';
import { getBoard } from '@/features/tracker/api/service';

export const metadata = { title: 'Dashboard: Tracker Board' };

type PageProps = { params: Promise<{ projectId: string }> };

export default async function Page(props: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  const { projectId } = await props.params;

  // Read once on the server for the header. The same query is prefetched and
  // hydrated below, so this is not a second round trip on render.
  const board = await getBoard(projectId);
  if (!board) notFound();

  const lead = board.project.lead ? ` · Lead: ${board.project.lead.name}` : '';

  return (
    <PageContainer
      pageTitle={board.project.name}
      pageDescription={`${board.project.description ?? 'Work tracked under this project.'}${lead}`}
    >
      <BoardViewPage projectId={projectId} />
    </PageContainer>
  );
}
