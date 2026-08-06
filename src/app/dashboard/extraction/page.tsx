import { Suspense } from 'react';
import PageContainer from '@/components/layout/page-container';
import { SectionLabel } from '@/components/ui/panel';
import CaptureQueueListing from '@/features/extraction/components/capture-queue-listing';
import MeetingListingPage from '@/features/extraction/components/meeting-listing';
import { searchParamsCache } from '@/lib/searchparams';
import { SearchParams } from 'nuqs/server';
import { requireRouteAccess } from '@/lib/current-actor';

export const metadata = {
  title: 'Capture queue'
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function Page(props: PageProps) {
  // ⚠️ Resource-based check, per CLAUDE.md. src/proxy.ts already matches
  // /dashboard(.*), but createRouteMatcher is deprecated and its path matching can
  // diverge from how Next.js actually routes. This page renders REAL MEETING
  // CONTENT, so it does not rely on the matcher alone.
  // ⚠️ Role gate + auth in one call. Redirects to the caller's own role home
  // rather than 403ing; the map is @/lib/route-access.
  await requireRouteAccess('/dashboard/extraction');

  const searchParams = await props.searchParams;
  searchParamsCache.parse(searchParams);

  return (
    // ⚠️ NO pageTitle. The Capture queue's own "Agentic capture" header and subtitle
    // are the page header; a PageContainer title would render a second heading.
    <PageContainer>
      <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading…</div>}>
        <CaptureQueueListing />
      </Suspense>

      {/*
        ⚠️ NOT IN THE MOCKUP, AND KEPT DELIBERATELY. The meetings table is the only
        UI path that triggers `fetchAndExtract` — a real write that stores a
        raw_event, pulls a live transcript and enqueues paid LLM work — and the only
        route to /dashboard/extraction/[id], where the narrow description/due-date
        edit affordance lives. Dropping it to match the mockup would leave the
        working ingestion trigger reachable only by typing a URL.

        Below the queue, under its own label, so the Capture queue reads as the
        page. Delete this block to match the mockup exactly.
      */}
      <div className='mt-[28px] max-w-[1180px]'>
        <SectionLabel>Meetings · fetch a transcript to extract from it</SectionLabel>
        <MeetingListingPage />
      </div>
    </PageContainer>
  );
}
