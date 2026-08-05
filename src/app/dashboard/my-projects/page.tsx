import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import PageContainer from '@/components/layout/page-container';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getCurrentActor } from '@/lib/current-actor';
import MyProjectsListing from '@/features/my-projects/components/my-projects-listing';

export const metadata = { title: 'My projects' };

/**
 * My projects — the coder persona's home screen.
 *
 * ⚠️ Nav-gated to `coder`; the auth check below is the actual control and is
 * resource-based per CLAUDE.md rather than relying on src/proxy.ts's deprecated
 * `createRouteMatcher`. No additional role gate — flipping a person's `role_id` is
 * how this screen gets tested.
 *
 * ⚠️ `now` IS RESOLVED HERE, ONCE, and threaded down, so every overdue decision
 * derives from one instant and both sides of the SSR handoff build the same key.
 */
export default async function MyProjectsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  /**
   * ⚠️ `getCurrentActor()`, NOT `requirePersonId()`. Being signed in without a
   * roster link is ordinary and recoverable — it deserves an explanation, not a
   * stack trace. Same pattern as My day and Briefs & quota.
   */
  const actor = await getCurrentActor();
  const nowIso = new Date().toISOString();

  return (
    // ⚠️ NO pageTitle. The "My projects" header row IS the page header.
    <PageContainer>
      {actor?.personId ? (
        <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading…</div>}>
          <MyProjectsListing personId={actor.personId} nowIso={nowIso} />
        </Suspense>
      ) : (
        <NotLinked email={actor?.email ?? null} />
      )}
    </PageContainer>
  );
}

/**
 * The unlinked-account state.
 *
 * ⚠️ ACTION-SHAPED, and it names the mechanism. This page is scoped to the work you
 * own, so it needs to know which roster row you are. Naming the fix turns the gap
 * into somebody's next task.
 */
function NotLinked({ email }: { email: string | null }) {
  return (
    <Card className='mx-auto mt-[10vh] flex max-w-[520px] flex-col items-center gap-[10px] p-[28px] text-center'>
      <Icons.code className='text-muted-foreground size-6' aria-hidden />
      <h1 className='text-[17px] font-bold'>Your account isn&rsquo;t linked yet</h1>
      <p className='text-muted-foreground text-[13px] leading-[1.55]'>
        My projects shows the work you own, so it needs to know which person on the roster you are.
        Ask an admin to link your account
        {email ? (
          <>
            {' '}
            — setting <span className='font-mono text-[12px]'>{email}</span> on your person record
            links it automatically on your next sign-in.
          </>
        ) : (
          '.'
        )}
      </p>
      {/*
        Navigation → a <Link> styled with buttonVariants, never a <Button> wrapping a
        link (Base UI `nativeButton`).
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
