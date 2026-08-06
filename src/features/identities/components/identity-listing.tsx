import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { searchParamsCache } from '@/lib/searchparams';
import { identitySourceOptionsQuery, unresolvedIdentitiesQueryOptions } from '../api/queries';
import { IdentityTable } from './identity-tables';

// Server component. Mirrors src/features/people/components/people-listing.tsx.
export default function IdentityListingPage() {
  const page = searchParamsCache.get('page');
  const search = searchParamsCache.get('name');
  const pageLimit = searchParamsCache.get('perPage');
  const source = searchParamsCache.get('source');
  const sort = searchParamsCache.get('sort');

  // This object must match the client's filters EXACTLY — see identity-tables/index.tsx.
  const filters = {
    page,
    limit: pageLimit,
    ...(search && { search }),
    ...(source && { sources: source }),
    ...(sort && { sort })
  };

  const queryClient = getQueryClient();

  // void, not await: the pending promise is dehydrated and resolves on the
  // client, so the server never blocks on it.
  void queryClient.prefetchQuery(unresolvedIdentitiesQueryOptions(filters));
  void queryClient.prefetchQuery(identitySourceOptionsQuery());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <IdentityTable />
    </HydrationBoundary>
  );
}
