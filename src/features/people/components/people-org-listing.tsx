import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { peopleOrgQueryOptions } from '../api/queries';
import { PeopleOrgBody } from './people-org';

/**
 * Server component: prefetch + hydrate, per the TanStack SSR pattern.
 *
 * ⚠️ `void`, NOT awaited — the pending promise is dehydrated and resolves on the
 * client. `src/lib/query-client.ts` sets `shouldDehydrateQuery` to include
 * `status === 'pending'`, which is what makes that work.
 *
 * ⚠️ `getQueryClient()` is called HERE, per request. It returns a fresh client on
 * the server and a singleton in the browser; hoisting it to module scope would
 * share one cache across every user's request.
 */
export default function PeopleOrgListing() {
  const queryClient = getQueryClient();

  void queryClient.prefetchQuery(peopleOrgQueryOptions());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PeopleOrgBody />
    </HydrationBoundary>
  );
}
