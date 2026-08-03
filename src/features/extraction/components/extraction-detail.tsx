import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { extractionDetailOptions } from '../api/queries';
import { ExtractionDetailView } from './extraction-detail-view';

export default function ExtractionDetailPage({ firefliesId }: { firefliesId: string }) {
  const queryClient = getQueryClient();

  void queryClient.prefetchQuery(extractionDetailOptions(firefliesId));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ExtractionDetailView firefliesId={firefliesId} />
    </HydrationBoundary>
  );
}
