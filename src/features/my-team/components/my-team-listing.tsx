import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { myTeamQueryOptions } from '../api/queries';
import { MyTeamBody } from './my-team-body';

/**
 * Server component: prefetch + hydrate, per the SSR pattern in CLAUDE.md.
 *
 * ⚠️ `nowIso` is resolved by the PAGE and threaded through, not created here. Both
 * sides of the handoff must build the same query key from the same instant.
 */
export default function MyTeamListing({
  departmentId,
  nowIso
}: {
  departmentId: string;
  nowIso: string;
}) {
  const queryClient = getQueryClient();

  // `void` deliberately — not awaited, so the server does not block.
  void queryClient.prefetchQuery(myTeamQueryOptions(departmentId, nowIso));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MyTeamBody departmentId={departmentId} nowIso={nowIso} />
    </HydrationBoundary>
  );
}
