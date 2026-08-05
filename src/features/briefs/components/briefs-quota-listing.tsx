import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { briefsQuotaScreenOptions } from '../api/queries';
import { BriefsQuotaView } from './briefs-quota-view';

/**
 * Server component: prefetch + hydrate, per the SSR pattern in CLAUDE.md.
 *
 * ⚠️ `nowIso` is resolved by the PAGE and threaded through, so both sides of the
 * handoff build the same query key from the same instant.
 */
export default function BriefsQuotaListing({
  personId,
  nowIso
}: {
  personId: string;
  nowIso: string;
}) {
  const queryClient = getQueryClient();

  // `void` deliberately — not awaited, so the server does not block.
  void queryClient.prefetchQuery(briefsQuotaScreenOptions(personId, nowIso));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BriefsQuotaView personId={personId} nowIso={nowIso} />
    </HydrationBoundary>
  );
}
