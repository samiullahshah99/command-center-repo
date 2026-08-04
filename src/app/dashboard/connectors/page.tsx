import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import PageContainer from '@/components/layout/page-container';
import ConnectorHealthListing from '@/features/connector-health/components/connector-health-listing';

export const metadata = {
  title: 'Connectors'
};

export default async function ConnectorsPage() {
  // Resource-based auth in the page itself, per CLAUDE.md — new protected routes
  // do not rely on src/proxy.ts's deprecated createRouteMatcher.
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  return (
    <PageContainer
      pageTitle='Connectors'
      pageDescription='Ingestion and worker health per source. Read-only.'
    >
      <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading health…</div>}>
        <ConnectorHealthListing />
      </Suspense>
    </PageContainer>
  );
}
