import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { connectorHealthQueryOptions } from '../api/queries';
import { ConnectorHealthView } from './connector-health-view';

// Server component: prefetch + hydrate, per the SSR pattern in CLAUDE.md.
// `void` deliberately — not awaited, so the server does not block; the pending
// promise is dehydrated and resolves on the client.
export default function ConnectorHealthListing() {
  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(connectorHealthQueryOptions());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ConnectorHealthView />
    </HydrationBoundary>
  );
}
