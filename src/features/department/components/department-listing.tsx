import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { departmentQueryOptions } from '../api/queries';
import { DepartmentBody } from './department-body';

/**
 * Server component: prefetch + hydrate, per the SSR pattern in CLAUDE.md.
 *
 * ⚠️ `nowIso` is resolved by the PAGE and threaded through, so both sides of the
 * handoff build the same query key from the same instant.
 */
export default function DepartmentListing({
  departmentId,
  nowIso
}: {
  departmentId: string;
  nowIso: string;
}) {
  const queryClient = getQueryClient();

  // `void` deliberately — not awaited, so the server does not block.
  void queryClient.prefetchQuery(departmentQueryOptions(departmentId, nowIso));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DepartmentBody departmentId={departmentId} nowIso={nowIso} />
    </HydrationBoundary>
  );
}
