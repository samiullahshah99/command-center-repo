import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { founderOffloadQueryOptions } from '../api/queries';
import { FounderOffloadBody } from './founder-offload-body';

/**
 * Server component: prefetch + hydrate, per the TanStack SSR pattern.
 *
 * ⚠️ `void`, NOT awaited — the pending promise is dehydrated and resolves on the
 * client, which works because `src/lib/query-client.ts` sets
 * `shouldDehydrateQuery` to include `status === 'pending'`.
 *
 * ⚠️ `getQueryClient()` is called HERE, per request: fresh on the server, a
 * singleton in the browser. Hoisting it to module scope would share one cache
 * across every request.
 */
export default function FounderOffloadListing() {
  const queryClient = getQueryClient();

  void queryClient.prefetchQuery(founderOffloadQueryOptions());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <FounderOffloadBody />
    </HydrationBoundary>
  );
}
