import PageContainer from '@/components/layout/page-container';
import { NotBuiltYet } from '@/components/layout/not-built-yet';

export const metadata = { title: 'Dashboard · Department' };

/**
 * Department detail — routed so the sidebar's Departments rows do not 404.
 *
 * ⚠️ Deliberately does NOT look the department up yet. It could render the name
 * and health from `getDeptNav()`, but a page showing a real name and a real
 * health dot above an empty body reads as a screen that failed to load its
 * content rather than one that was never built. The audit's §2.4 needs the
 * header, per-dept projects, the risk list and the type-conditional panels
 * together — half of it is more misleading than none.
 */
export default async function Page({ params }: { params: Promise<{ departmentId: string }> }) {
  // Awaited but unused: Next 16 requires params to be awaited, and destructuring
  // it here documents the route's shape for whoever builds the real screen.
  await params;

  return (
    <PageContainer
      pageTitle='Department'
      pageDescription='Health, projects, risks and the type-specific panels for one department.'
    >
      <NotBuiltYet
        needs='Needs the department header, per-dept project and risk queries, and the creative/CX conditional panels. Health already computes — see src/lib/dept-health.ts, wired into the sidebar.'
        auditRef='§2.4'
      />
    </PageContainer>
  );
}
