import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import PageContainer from '@/components/layout/page-container';
import BriefBoardListing from '@/features/briefs/components/brief-board-listing';

export const metadata = { title: 'Briefs' };

export default async function BriefsPage() {
  // Resource-based auth in the page, per CLAUDE.md — new protected routes do not
  // rely on src/proxy.ts's deprecated createRouteMatcher.
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  return (
    <PageContainer
      pageTitle='Briefs'
      pageDescription='Brief state derived from Vision events. Read-only.'
    >
      <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading briefs…</div>}>
        <BriefBoardListing />
      </Suspense>
    </PageContainer>
  );
}
