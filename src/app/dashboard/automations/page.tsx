import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import PageContainer from '@/components/layout/page-container';
import AutomationsListing from '@/features/automations/components/automations-listing';

export const metadata = { title: 'Role profiles & automations' };

/**
 * Automations — the ops-lead overview of role profiles and auto-completion rules.
 *
 * ⚠️ Nav-gated to `ops_lead`; the auth check below is the actual control and is
 * resource-based per CLAUDE.md rather than relying on src/proxy.ts's deprecated
 * `createRouteMatcher`. No additional role gate — flipping a person's `role_id` is
 * how this screen gets tested.
 *
 * ⚠️ READ-ONLY. Editing lives on the EXISTING admin surface at
 * `/dashboard/role-profiles` and `/dashboard/role-profiles/[roleProfileId]`; every
 * row here links there. This page adds no mutations.
 *
 * ⚠️ NOT me-scoped, unlike My day / My team / My projects — this is a company-wide
 * configuration view, so it needs no actor and gets no not-linked card.
 *
 * ⚠️ `now` IS RESOLVED HERE, ONCE, and threaded down, so both sides of the SSR
 * handoff build the same query key from the same instant.
 */
export default async function AutomationsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  const nowIso = new Date().toISOString();

  return (
    // ⚠️ NO pageTitle. The "Role profiles & automations" header row IS the page
    // header; a PageContainer title would render a second heading above it.
    <PageContainer>
      <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading…</div>}>
        <AutomationsListing nowIso={nowIso} />
      </Suspense>
    </PageContainer>
  );
}
