import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { searchParamsCache } from '@/lib/searchparams';
import { peopleQueryOptions, roleProfileOptionsQuery } from '../api/queries';
import { PeopleTable } from './people-table';

// Server component. Mirrors src/features/products/components/product-listing.tsx.
export default function PeopleListingPage() {
  const page = searchParamsCache.get('page');
  const search = searchParamsCache.get('name');
  const pageLimit = searchParamsCache.get('perPage');
  const roleProfiles = searchParamsCache.get('role');
  const sort = searchParamsCache.get('sort');

  // This object must match the client's filters EXACTLY or the query key
  // diverges, the dehydrated cache misses, and the table refetches on mount.
  const filters = {
    page,
    limit: pageLimit,
    ...(search && { search }),
    ...(roleProfiles && { roleProfiles }),
    ...(sort && { sort })
  };

  const queryClient = getQueryClient();

  void queryClient.prefetchQuery(peopleQueryOptions(filters));
  // Prefetched too, so the role-profile filter dropdown is populated on first paint.
  void queryClient.prefetchQuery(roleProfileOptionsQuery());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PeopleTable />
    </HydrationBoundary>
  );
}
