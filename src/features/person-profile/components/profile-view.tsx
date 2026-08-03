import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { personProfileOptions, rosterOptions } from '../api/queries';
import { ProfileBody } from './profile-body';

export default function ProfileViewPage({ personId }: { personId: string }) {
  const queryClient = getQueryClient();

  // `void`, not awaited — the pending promise is dehydrated and resolves on the
  // client. Matters more than usual here: the profile query may make an LLM call
  // on a cache miss, and blocking the server render on that would delay the
  // whole page for a card the page is designed to work without.
  void queryClient.prefetchQuery(personProfileOptions(personId));
  void queryClient.prefetchQuery(rosterOptions());

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProfileBody personId={personId} />
    </HydrationBoundary>
  );
}
