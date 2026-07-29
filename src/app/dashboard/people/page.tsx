import PageContainer from '@/components/layout/page-container';
import { buttonVariants } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import PeopleListingPage from '@/features/people/components/people-listing';
import { searchParamsCache } from '@/lib/searchparams';
import { cn } from '@/lib/utils';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SearchParams } from 'nuqs/server';

export const metadata = {
  title: 'Dashboard: People'
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
      pageTitle='People'
      pageDescription='The team roster and their role profile assignments.'
      pageHeaderAction={
        <Link href='/dashboard/people/new' className={cn(buttonVariants(), 'text-xs md:text-sm')}>
          <Icons.add className='mr-2 h-4 w-4' /> Add Person
        </Link>
      }
    >
      <PeopleListingPage />
    </PageContainer>
  );
}
