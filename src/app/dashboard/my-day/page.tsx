import { Suspense } from 'react';
import Link from 'next/link';
import PageContainer from '@/components/layout/page-container';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getCurrentActor, requireRouteAccess } from '@/lib/current-actor';
import MyDayListing from '@/features/my-day/components/my-day-listing';

export const metadata = { title: 'My day' };

/**
 * My day — the "me"-scoped screen.
 *
 * ⚠️ Reached from the sidebar by cx_agent / creative / coder / support_manager. The
 * nav gate is visibility only; the auth check below is the actual control, and it is
 * resource-based per CLAUDE.md rather than relying on src/proxy.ts's deprecated
 * `createRouteMatcher`.
 *
 * ⚠️ `now` IS RESOLVED HERE, ONCE, and threaded down. Every due-date comparison, the
 * greeting band and the week boundary derive from it, so the page cannot disagree
 * with itself about what "today" is — and both sides of the SSR handoff build the
 * same query key from the same instant. See `myDayQueryOptions`.
 */
export default async function MyDayPage() {
  // ⚠️ Role gate + auth in one call. Redirects to the caller's own role home
  // rather than 403ing; the map is @/lib/route-access.
  await requireRouteAccess('/dashboard/my-day');

  /**
   * ⚠️ `getCurrentActor()`, NOT `requirePersonId()`.
   *
   * `requirePersonId()` throws when the Clerk account is not linked to a roster
   * person, which would render an error page for a state that is ordinary and
   * recoverable: signed in, real, just not on the roster yet. That is a fact about
   * OUR data with a fix somebody can act on, so it gets an explanation rather than a
   * stack trace. The actor is memoised per request, so this is the same resolution
   * the sidebar already performed.
   */
  const actor = await getCurrentActor();

  if (!actor?.personId) {
    return (
      <PageContainer>
        <NotLinked email={actor?.email ?? null} />
      </PageContainer>
    );
  }

  const nowIso = new Date().toISOString();

  return (
    // ⚠️ NO pageTitle. The greeting row IS this page's header — a PageContainer title
    // would render a second heading ten pixels above it.
    <PageContainer>
      <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading…</div>}>
        <MyDayListing personId={actor.personId} nowIso={nowIso} />
      </Suspense>
    </PageContainer>
  );
}

/**
 * The unlinked-account state.
 *
 * ⚠️ ACTION-SHAPED, and it names the mechanism. "No data" is a dead end; saying the
 * account is not linked to a roster person — and that an admin links it by setting
 * that person's email — turns the gap into somebody's next task. This is the
 * expected state for anyone signing in before `pnpm people:email` has run for them,
 * which is most of the roster today.
 */
function NotLinked({ email }: { email: string | null }) {
  return (
    <Card className='mx-auto mt-[10vh] flex max-w-[520px] flex-col items-center gap-[10px] p-[28px] text-center'>
      <Icons.user className='text-muted-foreground size-6' aria-hidden />
      <h1 className='text-[17px] font-bold'>Your account isn&rsquo;t linked yet</h1>
      <p className='text-muted-foreground text-[13px] leading-[1.55]'>
        My day shows the work assigned to you, so it needs to know which person on the roster you
        are. Ask an admin to link your account
        {email ? (
          <>
            {' '}
            — they can set <span className='font-mono text-[12px]'>{email}</span> on your person
            record, and the link happens automatically on your next sign-in.
          </>
        ) : (
          '.'
        )}
      </p>
      {/*
        Navigation → a <Link> styled with buttonVariants, never a <Button> wrapping a
        link (Base UI `nativeButton`). Same pattern as header-bar.tsx.
      */}
      <Link
        href='/dashboard/identities'
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-[4px]')}
      >
        View unlinked identities
      </Link>
    </Card>
  );
}
