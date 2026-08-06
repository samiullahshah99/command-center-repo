import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { SearchParams } from 'nuqs/server';
import PageContainer from '@/components/layout/page-container';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/panel';
import PeopleListingPage from '@/features/people/components/people-listing';
import PeopleOrgListing from '@/features/people/components/people-org-listing';
import { searchParamsCache } from '@/lib/searchparams';
import { cn } from '@/lib/utils';

export const metadata = { title: 'People & org' };

type PageProps = {
  searchParams: Promise<SearchParams>;
};

/**
 * People & org.
 *
 * ⚠️ Nav-gated to `founder` / `ops_lead`; the auth check below is the actual
 * control and is resource-based per CLAUDE.md rather than relying on
 * src/proxy.ts's deprecated `createRouteMatcher`. No additional role gate —
 * flipping a person's `role_id` is how this screen gets tested.
 *
 * ⚠️ NOT me-scoped — this is the company roster, so it needs no actor and gets no
 * not-linked card.
 */
export default async function Page(props: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  /*
    ⚠️ STILL PARSED, for the roster board below. The org chart takes no filters,
    but PeopleListingPage reads page/name/perPage/role/sort off this cache and
    would fall back to defaults without it — which would then disagree with the
    client's `useQueryStates` and miss the hydration.
  */
  const searchParams = await props.searchParams;
  searchParamsCache.parse(searchParams);

  return (
    // ⚠️ NO pageTitle. The "People & org" header row inside the feature IS the
    // page header; a PageContainer title would render a second heading above it.
    <PageContainer>
      <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading…</div>}>
        <PeopleOrgListing />
      </Suspense>

      {/*
        ⚠️ KEPT — the existing, working roster board. It is the only route to the
        person drawer (identity badges per source, 14-day activity sparkline,
        pending-item counts), the only place a person can be created or edited,
        and the only surface showing the brief quota reconciled in the briefs
        session. The mockup shows none of it, and dropping it to match would take
        the roster's only write path offline.

        Below the org chart, under its own label. Delete this block to match the
        mockup exactly.
      */}
      <div className='mt-[28px] max-w-[1080px]'>
        <div className='mb-[10px] flex items-center justify-between gap-3'>
          <SectionLabel className='mb-0'>Roster · identities, activity and editing</SectionLabel>
          {/*
            Navigation → a <Link> styled with buttonVariants, never a <Button>
            wrapping a link (Base UI `nativeButton`).
          */}
          <Link
            href='/dashboard/people/new'
            className={cn(buttonVariants({ size: 'sm' }), 'text-xs')}
          >
            <Icons.add className='mr-1 h-4 w-4' /> Add person
          </Link>
        </div>
        <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading roster…</div>}>
          <PeopleListingPage />
        </Suspense>
      </div>
    </PageContainer>
  );
}
