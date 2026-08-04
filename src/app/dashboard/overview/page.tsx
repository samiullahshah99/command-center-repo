import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import PageContainer from '@/components/layout/page-container';
import HomeListing from '@/features/home/components/home-listing';

export const metadata = { title: 'Overview' };

/**
 * The Command Center landing page.
 *
 * Replaced the dashboard starter's parallel-routes demo entirely — four fake
 * charts, hardcoded revenue figures, and 1–3s artificial `delay()` calls. Nothing
 * on this page is sampled now; every number comes from a real query.
 *
 * Sidebar label stays "Overview"; it becomes Control Tower when it earns it.
 */
export default async function OverviewPage() {
  // Resource-based auth in the page, per CLAUDE.md — new protected routes do not
  // rely on src/proxy.ts's deprecated createRouteMatcher.
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  return (
    <PageContainer pageTitle='Overview' pageDescription='What needs your attention.'>
      <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading…</div>}>
        <HomeListing />
      </Suspense>
    </PageContainer>
  );
}
