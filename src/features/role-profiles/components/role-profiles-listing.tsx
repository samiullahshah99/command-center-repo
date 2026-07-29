import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { searchParamsCache } from '@/lib/searchparams';
import { roleProfilesQueryOptions } from '../api/queries';
import { RoleProfilesTable } from './role-profiles-table';

// Server component. Mirrors src/features/products/components/product-listing.tsx.
export default function RoleProfilesListingPage() {
  const page = searchParamsCache.get('page');
  const search = searchParamsCache.get('name');
  const pageLimit = searchParamsCache.get('perPage');
  const sort = searchParamsCache.get('sort');

  const filters = {
    page,
    limit: pageLimit,
    ...(search && { search }),
    ...(sort && { sort })
  };

  const queryClient = getQueryClient();

  void queryClient.prefetchQuery(roleProfilesQueryOptions(filters));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RoleProfilesTable />
    </HydrationBoundary>
  );
}
