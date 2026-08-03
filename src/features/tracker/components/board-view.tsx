import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { boardQueryOptions } from '../api/queries';
import { BoardTable } from './board-table';

export default function BoardViewPage({ projectId }: { projectId: string }) {
  const queryClient = getQueryClient();

  void queryClient.prefetchQuery(boardQueryOptions(projectId));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BoardTable projectId={projectId} />
    </HydrationBoundary>
  );
}
