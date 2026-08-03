import PageContainer from '@/components/layout/page-container';
import MeetingListingPage from '@/features/extraction/components/meeting-listing';
import { searchParamsCache } from '@/lib/searchparams';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { SearchParams } from 'nuqs/server';

export const metadata = {
  title: 'Dashboard: Extraction'
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function Page(props: PageProps) {
  // ⚠️ Resource-based check, per CLAUDE.md. src/proxy.ts already matches
  // /dashboard(.*), but createRouteMatcher is deprecated and its path matching
  // can diverge from how Next.js actually routes. This page renders REAL MEETING
  // CONTENT, so it does not rely on the matcher alone.
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  const searchParams = await props.searchParams;
  searchParamsCache.parse(searchParams);

  return (
    <PageContainer
      pageTitle='Extraction'
      pageDescription='Recent Fireflies meetings. Fetch one to pull its transcript and extract action items — each item keeps the verbatim quote it came from, so it can be checked against what was actually said.'
    >
      <MeetingListingPage />
    </PageContainer>
  );
}
