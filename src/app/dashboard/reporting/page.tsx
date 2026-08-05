import PageContainer from '@/components/layout/page-container';
import { NotBuiltYet } from '@/components/layout/not-built-yet';

export const metadata = { title: 'Dashboard · Reporting' };

export default function Page() {
  return (
    <PageContainer
      pageTitle='Reporting'
      pageDescription='Agency reporting — required reports, captured updates and API metrics.'
    >
      <NotBuiltYet
        needs='Needs the agency model, Klaviyo metrics and a Slack capture watcher.'
        auditRef='§2.15'
      />
    </PageContainer>
  );
}
