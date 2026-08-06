import { Suspense } from 'react';
import Link from 'next/link';
import PageContainer from '@/components/layout/page-container';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getCurrentActor, requireRouteAccess } from '@/lib/current-actor';
import { resolveTeamScope } from '@/features/my-team/api/service';
import MyTeamListing from '@/features/my-team/components/my-team-listing';

export const metadata = { title: 'My team' };

/**
 * My team — the support manager's department view.
 *
 * ⚠️ Nav-gated to `support_manager`; the auth check below is the actual control and
 * is resource-based per CLAUDE.md rather than relying on src/proxy.ts's deprecated
 * `createRouteMatcher`.
 *
 * ⚠️ The page does NOT additionally hard-require the support_manager role. Flipping
 * a person's `role_id` is how this screen gets tested before a real support manager
 * is onboarded, and a second gate here would make that impossible without editing
 * code. The nav decides visibility; `requireUser` decides access.
 *
 * ⚠️ `now` IS RESOLVED HERE, ONCE, and threaded down, so every overdue decision on
 * the page derives from one instant and both sides of the SSR handoff build the
 * same query key.
 */
export default async function MyTeamPage() {
  // ⚠️ Role gate + auth in one call. Redirects to the caller's own role home
  // rather than 403ing; the map is @/lib/route-access.
  await requireRouteAccess('/dashboard/my-team');

  const actor = await getCurrentActor();

  /**
   * ⚠️ THE TEAM ASSUMPTION LIVES IN THE SERVICE, not here. `resolveTeamScope`
   * encodes "team ≡ department" in one place with the open question named — see its
   * header. This page only reacts to the answer.
   */
  const scope = await resolveTeamScope(actor?.departmentId ?? null);

  if (!scope) {
    return (
      <PageContainer>
        <NoDepartment linked={Boolean(actor?.personId)} />
      </PageContainer>
    );
  }

  const nowIso = new Date().toISOString();

  return (
    // ⚠️ NO pageTitle. The "My team — {department}" header row IS the page header.
    <PageContainer>
      <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading…</div>}>
        <MyTeamListing departmentId={scope.departmentId} nowIso={nowIso} />
      </Suspense>
    </PageContainer>
  );
}

/**
 * The no-department state.
 *
 * ⚠️ ACTION-SHAPED, and it distinguishes the two causes. "Not linked to a person at
 * all" and "linked but unassigned" have different fixes, and one message for both
 * would hide whichever task actually applies — the same reasoning as the person
 * profile's activity strip.
 */
function NoDepartment({ linked }: { linked: boolean }) {
  return (
    <Card className='mx-auto mt-[10vh] flex max-w-[520px] flex-col items-center gap-[10px] p-[28px] text-center'>
      <Icons.teams className='text-muted-foreground size-6' aria-hidden />
      <h1 className='text-[17px] font-bold'>You&rsquo;re not assigned to a department yet</h1>
      <p className='text-muted-foreground text-[13px] leading-[1.55]'>
        {linked
          ? 'My team shows the work owned by your department, so it needs to know which one you are in. Ask an admin to set your department on your person record.'
          : 'Your account isn’t linked to a roster person yet, so there is no department to show. Ask an admin to link it first.'}
      </p>
      {/*
        Navigation → a <Link> styled with buttonVariants, never a <Button> wrapping a
        link (Base UI `nativeButton`).
      */}
      <Link
        href='/dashboard/people'
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-[4px]')}
      >
        View People &amp; org
      </Link>
    </Card>
  );
}
