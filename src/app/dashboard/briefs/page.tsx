import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import PageContainer from '@/components/layout/page-container';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionLabel } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { getCurrentActor } from '@/lib/current-actor';
import BriefBoardListing from '@/features/briefs/components/brief-board-listing';
import BriefsQuotaListing from '@/features/briefs/components/briefs-quota-listing';

export const metadata = { title: 'Briefs & quota' };

/**
 * Briefs & quota — the creative persona's home screen.
 *
 * ⚠️ Nav-gated to `creative`; the auth check below is the actual control and is
 * resource-based per CLAUDE.md rather than relying on src/proxy.ts's deprecated
 * `createRouteMatcher`. No additional role gate — flipping a person's `role_id` is
 * how this screen gets tested.
 *
 * ⚠️ `now` IS RESOLVED HERE, ONCE, and threaded down, so both sides of the SSR
 * handoff build the same query key from the same instant.
 */
export default async function BriefsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  /**
   * ⚠️ `getCurrentActor()`, NOT `requirePersonId()`. The quota hero is me-scoped, and
   * "signed in but not on the roster" is an ordinary, recoverable state that
   * deserves an explanation rather than a stack trace. Same pattern as My day.
   */
  const actor = await getCurrentActor();
  const nowIso = new Date().toISOString();

  return (
    // ⚠️ NO pageTitle. The "Briefs & quota" header row IS the page header.
    <PageContainer>
      {actor?.personId ? (
        <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading…</div>}>
          <BriefsQuotaListing personId={actor.personId} nowIso={nowIso} />
        </Suspense>
      ) : (
        <NotLinked email={actor?.email ?? null} />
      )}

      {/*
        ⚠️ KEPT — the existing, working brief board. It is the only route to
        /dashboard/briefs' per-brief detail panel (event timeline, comments, script
        saves), which nothing else links to, and it renders every brief rather than
        just the non-terminal backlog above. Dropping it to match the mockup would
        make a working surface reachable only by memory.

        Below the quota screen, under its own label. Delete this block to match the
        mockup exactly.
      */}
      <div className='mt-[28px] max-w-[1080px]'>
        <SectionLabel>All briefs · board and per-brief timeline</SectionLabel>
        <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading briefs…</div>}>
          <BriefBoardListing />
        </Suspense>
      </div>
    </PageContainer>
  );
}

/**
 * The unlinked-account state.
 *
 * ⚠️ ACTION-SHAPED. The quota is per person, so it needs to know which roster row
 * you are. Naming the fix turns the gap into somebody's next task.
 */
function NotLinked({ email }: { email: string | null }) {
  return (
    <Card className='mx-auto flex max-w-[520px] flex-col items-center gap-[10px] p-[28px] text-center'>
      <Icons.post className='text-muted-foreground size-6' aria-hidden />
      <h1 className='text-[17px] font-bold'>Your account isn&rsquo;t linked yet</h1>
      <p className='text-muted-foreground text-[13px] leading-[1.55]'>
        The weekly quota is counted per person, so it needs to know which person on the roster you
        are. Ask an admin to link your account
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
      <Link
        href='/dashboard/identities'
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-[4px]')}
      >
        View unlinked identities
      </Link>
    </Card>
  );
}
