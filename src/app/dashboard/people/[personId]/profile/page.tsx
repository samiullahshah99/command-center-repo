import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import PageContainer from '@/components/layout/page-container';
import ProfileViewPage from '@/features/person-profile/components/profile-view';
import { getPersonProfile } from '@/features/person-profile/api/service';

export const metadata = { title: 'Dashboard: Person profile' };

type PageProps = { params: Promise<{ personId: string }> };

export default async function Page(props: PageProps) {
  // Resource-based check per CLAUDE.md — src/proxy.ts matches /dashboard(.*),
  // but createRouteMatcher is deprecated and can diverge from Next's routing.
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  const { personId } = await props.params;

  // Read once on the server for the header text. Same query is prefetched and
  // hydrated below, so this is not a second round trip.
  const profile = await getPersonProfile(personId);
  if (!profile) notFound();

  return (
    <PageContainer
      pageTitle={profile.person.name}
      pageDescription={`${profile.person.role ?? 'No role profile'} · ${profile.counts.open} open, ${profile.counts.overdue} overdue`}
    >
      <ProfileViewPage personId={personId} />
    </PageContainer>
  );
}
