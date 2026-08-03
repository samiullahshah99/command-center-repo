import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import PageContainer from '@/components/layout/page-container';
import { MockupBanner } from '@/features/tracker-mockups/components/mockup-banner';
import { PersonProfile } from '@/features/tracker-mockups/components/person/person-profile';

export const metadata = { title: 'Mockup: Person profile' };

export default async function Page() {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  return (
    <PageContainer
      pageTitle='Person profile'
      pageDescription='One person’s workload, with a placeholder AI summary above the list. Use the chips to switch person — the data is static either way.'
    >
      <MockupBanner />
      <PersonProfile />
    </PageContainer>
  );
}
