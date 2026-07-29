import PageContainer from '@/components/layout/page-container';
import { buttonVariants } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import RoleProfilesListingPage from '@/features/role-profiles/components/role-profiles-listing';
import { searchParamsCache } from '@/lib/searchparams';
import { cn } from '@/lib/utils';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SearchParams } from 'nuqs/server';

export const metadata = {
  title: 'Dashboard: Role Profiles'
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function Page(props: PageProps) {
  // Resource-based auth check, per CLAUDE.md — does not rely on the deprecated
  // createRouteMatcher in src/proxy.ts.
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  const searchParams = await props.searchParams;
  searchParamsCache.parse(searchParams);

  return (
    <PageContainer
      pageTitle='Role Profiles'
      pageDescription='What we monitor for each role, and where those signals come from.'
      pageHeaderAction={
        <Link
          href='/dashboard/role-profiles/new'
          className={cn(buttonVariants(), 'text-xs md:text-sm')}
        >
          <Icons.add className='mr-2 h-4 w-4' /> Add Role Profile
        </Link>
      }
    >
      <RoleProfilesListingPage />
    </PageContainer>
  );
}
