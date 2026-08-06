import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import PageContainer from '@/components/layout/page-container';
import { roleProfileByIdOptions } from '@/features/role-profiles/api/queries';
import RoleProfileViewPage from '@/features/role-profiles/components/role-profile-view-page';
import { requireRouteAccess } from '@/lib/current-actor';

export const metadata = {
  title: 'Dashboard : Role Profile'
};

type PageProps = { params: Promise<{ roleProfileId: string }> };

export default async function Page(props: PageProps) {
  // ⚠️ Role gate + auth in one call. Redirects to the caller's own role home
  // rather than 403ing; the map is @/lib/route-access.
  await requireRouteAccess('/dashboard/role-profiles/[roleProfileId]');

  const params = await props.params;
  const queryClient = getQueryClient();

  if (params.roleProfileId !== 'new') {
    void queryClient.prefetchQuery(roleProfileByIdOptions(params.roleProfileId));
  }

  return (
    <PageContainer>
      <div className='flex-1 space-y-4'>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <RoleProfileViewPage roleProfileId={params.roleProfileId} />
        </HydrationBoundary>
      </div>
    </PageContainer>
  );
}
