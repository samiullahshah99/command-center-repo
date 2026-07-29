import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import PageContainer from '@/components/layout/page-container';
import { personByIdOptions, roleProfileOptionsQuery } from '@/features/people/api/queries';
import PersonViewPage from '@/features/people/components/person-view-page';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Dashboard : Person'
};

type PageProps = { params: Promise<{ personId: string }> };

export default async function Page(props: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  const params = await props.params;
  const queryClient = getQueryClient();

  if (params.personId !== 'new') {
    void queryClient.prefetchQuery(personByIdOptions(params.personId));
  }
  // Needed by the form's role-profile select in both create and edit modes.
  void queryClient.prefetchQuery(roleProfileOptionsQuery());

  return (
    <PageContainer>
      <div className='flex-1 space-y-4'>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <PersonViewPage personId={params.personId} />
        </HydrationBoundary>
      </div>
    </PageContainer>
  );
}
