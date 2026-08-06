import Link from 'next/link';
import { redirect } from 'next/navigation';
import PageContainer from '@/components/layout/page-container';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getCurrentActor } from '@/lib/current-actor';
import { homeForRole } from '@/lib/route-access';
import { cn } from '@/lib/utils';

export const metadata = { title: 'No role assigned' };

/**
 * Where an actor with NO role lands.
 *
 * ⚠️⚠️ THIS PAGE MUST NEVER BE ROLE-GATED, and it is deliberately absent from
 * `ROUTE_ACCESS`. It is the redirect target for a null `roleCode`; gating it would
 * bounce a no-role actor to itself forever. A test asserts it stays unlisted.
 *
 * ⚠️ IT IS NOT AN ERROR PAGE. Being signed in without a roster role is an
 * ordinary, recoverable state — a new hire whose `person` row has no `role_id`, or
 * a Clerk account whose email is not on the roster. It reads as a next step for
 * somebody, not as a failure.
 *
 * ⚠️ A ROLE-HOLDER WHO ARRIVES HERE IS SENT ON. Otherwise a stale bookmark would
 * strand someone perfectly authorised on a dead end.
 */
export default async function Page() {
  const actor = await getCurrentActor();
  if (!actor) redirect('/auth/sign-in');

  // Has a role after all — this page is not for them.
  if (actor.roleCode) redirect(homeForRole(actor.roleCode));

  const isUnlinked = !actor.personId;

  return (
    <PageContainer>
      <Card className='mx-auto mt-[10vh] flex max-w-[560px] flex-col items-center gap-[10px] p-[28px] text-center'>
        <Icons.lock className='text-muted-foreground size-6' aria-hidden />
        <h1 className='text-[17px] font-bold'>
          {isUnlinked ? 'Your account isn’t linked yet' : 'No role assigned yet'}
        </h1>

        <p className='text-muted-foreground text-[13px] leading-[1.55]'>
          {isUnlinked ? (
            <>
              You’re signed in, but this account isn’t matched to anyone on the roster yet, so there
              is no role to decide what you can see.
              {actor.email ? (
                <>
                  {' '}
                  Setting <span className='font-mono text-[12px]'>{actor.email}</span> on your
                  person record links it automatically on your next sign-in.
                </>
              ) : null}
            </>
          ) : (
            <>
              You’re on the roster
              {actor.personName ? (
                <>
                  {' '}
                  as <span className='font-semibold'>{actor.personName}</span>
                </>
              ) : null}
              , but no role has been set on your record yet. Every screen decides what to show from
              that role, so an admin needs to assign one.
            </>
          )}
        </p>

        {/*
          ⚠️ Navigation → a <Link> styled with buttonVariants, never a <Button>
          wrapping a link (Base UI `nativeButton`).

          ⚠️ /dashboard/identities IS founder/ops-gated, so this button redirects a
          no-role actor straight back here. That is intentional and harmless: the
          link exists so the person reading over their shoulder — usually the admin
          being asked — has somewhere to go.
        */}
        <Link
          href='/dashboard/identities'
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-[4px]')}
        >
          Admin: link identities
        </Link>
      </Card>
    </PageContainer>
  );
}
