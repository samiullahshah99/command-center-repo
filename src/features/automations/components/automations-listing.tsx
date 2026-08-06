import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { automationsQueryOptions } from '../api/queries';
import { AutomationsBody } from './automations-body';

/**
 * Server component: prefetch + hydrate, per the SSR pattern in CLAUDE.md.
 *
 * ⚠️ `nowIso` is resolved by the PAGE and threaded through, so both sides of the
 * handoff build the same query key from the same instant.
 */
export default function AutomationsListing({ nowIso }: { nowIso: string }) {
  const queryClient = getQueryClient();

  // `void` deliberately — not awaited, so the server does not block.
  void queryClient.prefetchQuery(automationsQueryOptions(nowIso));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AutomationsBody nowIso={nowIso} />
    </HydrationBoundary>
  );
}
