import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { captureQueueOptions } from '../api/queries';
import { CaptureQueueView } from './capture-queue-view';

/**
 * Server component: prefetch + hydrate, per the SSR pattern in CLAUDE.md.
 *
 * `void` deliberately — not awaited, so the server does not block. The pending
 * promise is dehydrated and resolves on the client.
 */
export default function CaptureQueueListing() {
  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(captureQueueOptions());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CaptureQueueView />
    </HydrationBoundary>
  );
}
