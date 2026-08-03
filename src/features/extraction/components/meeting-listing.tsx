import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { meetingsQueryOptions } from '../api/queries';
import { MeetingTable } from './meeting-tables';

/** Must match DEFAULT_LIMIT in meeting-tables/index.tsx or hydration misses. */
const DEFAULT_LIMIT = 25;

export default function MeetingListingPage() {
  const queryClient = getQueryClient();

  // ⚠️ `void`, not awaited — deliberate. The pending promise is dehydrated and
  // resolves on the client, so the server does not block on a live Fireflies
  // call before sending any HTML. That only works because query-client.ts sets
  // shouldDehydrateQuery to include status === 'pending'.
  void queryClient.prefetchQuery(meetingsQueryOptions(DEFAULT_LIMIT));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MeetingTable />
    </HydrationBoundary>
  );
}
