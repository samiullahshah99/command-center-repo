import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/lib/current-actor';
import { homeForRole } from '@/lib/route-access';

/**
 * `/dashboard` — the post-sign-in landing route. Renders nothing; it forwards.
 *
 * ⚠️ IT FORWARDS TO THE ACTOR'S OWN ROLE HOME, not to `/dashboard/overview`.
 *
 * The hardcoded overview redirect that used to live here predates role gating and
 * would now cost every non-leadership user a visible double bounce:
 * `/dashboard` → `/dashboard/overview` → (denied) → `/dashboard/my-day`. The
 * middle hop is a screen they may not open, so the first thing a new CX agent's
 * browser would do is request a page it is about to be turned away from.
 *
 * ⚠️ A null role lands on the no-role page via `homeForRole` — the same
 * deny-by-default answer the page guard gives.
 */
export default async function Dashboard() {
  const actor = await getCurrentActor();
  if (!actor) redirect('/auth/sign-in');

  redirect(homeForRole(actor.roleCode));
}
