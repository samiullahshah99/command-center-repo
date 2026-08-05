import PageContainer from '@/components/layout/page-container';
import { NotBuiltYet } from '@/components/layout/not-built-yet';

export const metadata = { title: 'Dashboard · My day' };

export default function Page() {
  return (
    <PageContainer
      pageTitle='My day'
      pageDescription='Your items due today, recurring tasks and the latest meeting touching you.'
    >
      <NotBuiltYet
        needs='Needs the completion engine for recurring tasks, and a Meeting DTO assembled from transcripts.'
        auditRef='§2.10'
      />
    </PageContainer>
  );
}
