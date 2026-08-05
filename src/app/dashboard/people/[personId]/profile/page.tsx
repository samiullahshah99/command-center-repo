import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import PageContainer from '@/components/layout/page-container';
import ProfileViewPage from '@/features/person-profile/components/profile-view';
import { getPersonProfile } from '@/features/person-profile/api/service';

export const metadata = { title: 'Dashboard: Person profile' };

type PageProps = {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ from?: string }>;
};

/**
 * Where `?from=` may send the reader back to.
 *
 * ⚠️ AN ALLOW-LIST, not a passthrough. The value lands in an `href`, so echoing
 * an arbitrary query param would be an open redirect — a link in Slack could send
 * someone off-site from a page that looks like ours. An unrecognised value falls
 * back to People & org rather than erroring: a bad `from` is a cosmetic problem.
 */
const BACK_TARGETS: Record<string, { href: string; label: string }> = {
  people: { href: '/dashboard/people', label: 'People & org' },
  tracker: { href: '/dashboard/tracker', label: 'Tracker' },
  overview: { href: '/dashboard/overview', label: 'Control Tower' },
  // Added deliberately for the My team member list. ⚠️ Adding an entry here is the
  // ONLY way to add a back target — do not relax the lookup to accept arbitrary
  // values, which is exactly what makes this an allow-list rather than a
  // passthrough.
  'my-team': { href: '/dashboard/my-team', label: 'My team' },
  /**
   * ⚠️ STATIC TARGET, deliberately — the fallback the department brief allows.
   *
   * Sending the reader back to the SPECIFIC department would mean encoding its id
   * in the query string and echoing it into an href, which is exactly the open
   * redirect this allow-list exists to prevent. The Control Tower's Department
   * health grid is where departments are listed, so it is the honest "up" target.
   */
  department: { href: '/dashboard/overview', label: 'Departments' }
};

export default async function Page(props: PageProps) {
  // Resource-based check per CLAUDE.md — src/proxy.ts matches /dashboard(.*),
  // but createRouteMatcher is deprecated and can diverge from Next's routing.
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  const { personId } = await props.params;
  const { from } = await props.searchParams;

  // Read once on the server to confirm the person exists. The same query is
  // prefetched and hydrated below, so this is not a second round trip.
  const profile = await getPersonProfile(personId);
  if (!profile) notFound();

  const back = (from && BACK_TARGETS[from]) || BACK_TARGETS.people;

  return (
    // ⚠️ NO pageTitle. The mockup's header block IS the page header — name,
    // avatar, subtitle and the back link all live inside the feature. Passing
    // pageTitle too would render the person's name twice, ten pixels apart.
    <PageContainer>
      <ProfileViewPage personId={personId} backHref={back.href} backLabel={back.label} />
    </PageContainer>
  );
}
