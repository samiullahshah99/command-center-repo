import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { projectsQueryOptions } from '../api/queries';
import { ProjectCards } from './project-cards';

export default function ProjectListingPage() {
  const queryClient = getQueryClient();

  // `void`, not awaited — the pending promise is dehydrated and resolves on the
  // client. Works because query-client.ts includes status === 'pending' in
  // shouldDehydrateQuery.
  void queryClient.prefetchQuery(projectsQueryOptions());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProjectCards />
    </HydrationBoundary>
  );
}
