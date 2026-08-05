import PageContainer from '@/components/layout/page-container';
import { NotBuiltYet } from '@/components/layout/not-built-yet';

export const metadata = { title: 'Dashboard · My projects' };

export default function Page() {
  return (
    <PageContainer
      pageTitle='My projects'
      pageDescription='Projects you own, with progress and delivery signal.'
    >
      <NotBuiltYet
        needs='Needs project due-date and progress fields, plus the GitHub delivery signal.'
        auditRef='§2.13'
      />
    </PageContainer>
  );
}
