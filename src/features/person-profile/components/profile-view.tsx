import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { personProfileOptions } from '../api/queries';
import { ProfileBody } from './profile-body';

/** Where the header's back link points when the caller does not say. */
export const DEFAULT_BACK_HREF = '/dashboard/people';
export const DEFAULT_BACK_LABEL = 'People & org';

export default function ProfileViewPage({
  personId,
  backHref = DEFAULT_BACK_HREF,
  backLabel = DEFAULT_BACK_LABEL
}: {
  personId: string;
  /**
   * Overridable so a department page can send the reader back where they came
   * from. ⚠️ Must be an INTERNAL path — it is rendered straight into an href, and
   * accepting an arbitrary value from a query string would be an open redirect.
   * The route resolves it from a fixed allow-list, never from user input.
   */
  backHref?: string;
  backLabel?: string;
}) {
  const queryClient = getQueryClient();

  // `void`, not awaited — the pending promise is dehydrated and resolves on the
  // client. Matters more than usual here: the profile query may make an LLM call
  // on a cache miss, and blocking the server render on that would delay the whole
  // page for a card the page is designed to work without.
  void queryClient.prefetchQuery(personProfileOptions(personId));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProfileBody personId={personId} backHref={backHref} backLabel={backLabel} />
    </HydrationBoundary>
  );
}
