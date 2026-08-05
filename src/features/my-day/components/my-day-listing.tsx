import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { myDayQueryOptions } from '../api/queries';
import { MyDayBody } from './my-day-body';

/**
 * Server component: prefetch + hydrate, per the SSR pattern in CLAUDE.md.
 *
 * ⚠️ `nowIso` is resolved by the PAGE and threaded through here, not created in
 * this file. Both sides of the handoff must build the same query key from the same
 * instant — see the note on `myDayQueryOptions`.
 */
export default function MyDayListing({ personId, nowIso }: { personId: string; nowIso: string }) {
  const queryClient = getQueryClient();

  // `void` deliberately — not awaited, so the server does not block. The pending
  // promise is dehydrated and resolves on the client.
  void queryClient.prefetchQuery(myDayQueryOptions(personId, nowIso));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MyDayBody personId={personId} nowIso={nowIso} />
    </HydrationBoundary>
  );
}
