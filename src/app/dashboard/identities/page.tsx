import PageContainer from '@/components/layout/page-container';
import IdentityListingPage from '@/features/identities/components/identity-listing';
import { searchParamsCache } from '@/lib/searchparams';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { SearchParams } from 'nuqs/server';

export const metadata = {
  title: 'Dashboard: Identities'
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function Page(props: PageProps) {
  // Resource-based auth check, per CLAUDE.md. src/proxy.ts already matches
  // /dashboard(.*), but createRouteMatcher is deprecated and its path matching
  // can diverge from how Next.js actually routes — this does not rely on it.
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  const searchParams = await props.searchParams;
  searchParamsCache.parse(searchParams);

  return (
    <PageContainer
      pageTitle='Identities'
      pageDescription='External accounts seen in events that are not yet linked to a person. Email is the only automatic join key, so accounts from sources that send none — Slack always, Vision usually — land here for review.'
    >
      <IdentityListingPage />
    </PageContainer>
  );
}
