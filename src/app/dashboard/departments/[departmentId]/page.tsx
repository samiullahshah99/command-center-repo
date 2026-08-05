import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import PageContainer from '@/components/layout/page-container';
import DepartmentListing from '@/features/department/components/department-listing';
import { getDepartment } from '@/features/department/api/service';

export const metadata = { title: 'Department' };

type PageProps = { params: Promise<{ departmentId: string }> };

/**
 * Department detail — reached from the Control Tower's cards and the sidebar.
 *
 * ⚠️ Resource-based auth per CLAUDE.md, not a reliance on src/proxy.ts's deprecated
 * `createRouteMatcher`.
 *
 * ⚠️ `now` IS RESOLVED HERE, ONCE, and threaded down, so every date comparison
 * derives from one instant and both sides of the SSR handoff build the same key.
 */
export default async function Page(props: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  const { departmentId } = await props.params;
  const nowIso = new Date().toISOString();

  /**
   * ⚠️ THE PARAM IS UNTRUSTED INPUT. Resolved here BEFORE rendering so an unknown
   * or malformed id becomes a proper 404 rather than an empty page or a thrown
   * error boundary. `getDepartment` returns null for a miss rather than throwing,
   * precisely so this branch can exist.
   *
   * ⚠️ Not a second round trip: the same call is prefetched below and the query
   * client dedupes it within the request.
   */
  const dept = await getDepartment(departmentId, new Date(nowIso));
  if (!dept) notFound();

  return (
    // ⚠️ NO pageTitle. The department's own header row IS the page header.
    <PageContainer>
      <Suspense fallback={<div className='text-muted-foreground text-sm'>Loading…</div>}>
        <DepartmentListing departmentId={departmentId} nowIso={nowIso} />
      </Suspense>
    </PageContainer>
  );
}
