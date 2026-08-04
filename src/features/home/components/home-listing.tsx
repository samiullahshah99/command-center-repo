import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { homeSnapshotQueryOptions } from '../api/queries';
import { HomeView } from './home-view';

// Server component: prefetch + hydrate, per the SSR pattern in CLAUDE.md.
// `void` deliberately — not awaited, so the server does not block.
export default function HomeListing() {
  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(homeSnapshotQueryOptions());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HomeView />
    </HydrationBoundary>
  );
}
