import { Suspense } from 'react';
import PageContainer from '@/components/layout/page-container';
import ConnectorHealthListing from '@/features/connector-health/components/connector-health-listing';
import { requireRouteAccess } from '@/lib/current-actor';

export const metadata = {
  title: 'Connectors'
};

export default async function ConnectorsPage() {
  // Resource-based auth in the page itself, per CLAUDE.md — new protected routes
  // do not rely on src/proxy.ts's deprecated createRouteMatcher.
  // ⚠️ Role gate + auth in one call. Redirects to the caller's own role home
  // rather than 403ing; the map is @/lib/route-access.
  await requireRouteAccess('/dashboard/connectors');

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
