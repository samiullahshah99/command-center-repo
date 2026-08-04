import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { briefBoardQueryOptions } from '../api/queries';
import { BriefBoard } from './brief-board';

// Server component: prefetch + hydrate, per the SSR pattern in CLAUDE.md.
// `void` deliberately — not awaited, so the server does not block.
export default function BriefBoardListing() {
  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(briefBoardQueryOptions());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BriefBoard />
    </HydrationBoundary>
  );
}
