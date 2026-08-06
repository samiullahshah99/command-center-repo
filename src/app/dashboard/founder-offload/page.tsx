import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import PageContainer from '@/components/layout/page-container';
import FounderOffloadListing from '@/features/founder-offload/components/founder-offload-listing';

export const metadata = { title: 'Founder task offload' };

/**
 * Founder task offload.
 *
 * ⚠️ Nav-gated to `founder` / `ops_lead`; the auth check below is the actual
 * control and is resource-based per CLAUDE.md rather than relying on
 * src/proxy.ts's deprecated `createRouteMatcher`. No additional role gate —
 * flipping a person's `role_id` is how this screen gets tested.
 *
 * ⚠️ NOT me-scoped — the queue is the founder's, not the viewer's, so there is no
 * actor to resolve and no not-linked card.
 *
 * ⚠️ REPLACED the `NotBuiltYet` stub, and the honesty it carried is NOT lost: the
 * offload model is still unbuilt (audit §2.8), so the screen renders a screen-level
 * SampleDataCaption saying exactly that. A preview that dropped the disclaimer
 * along with the stub would be strictly worse than the stub.
 *
 * ⚠️ NO `now`. Nothing on this screen is time-dependent; see `getFounderOffload`.
 */
export default async function Page() {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  return (
    // ⚠️ NO pageTitle. The "Founder task offload" header row inside the feature IS
    // the page header; a PageContainer title would render a second heading above it.
    <PageContainer>
      <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading…</div>}>
        <FounderOffloadListing />
      </Suspense>
    </PageContainer>
  );
}
