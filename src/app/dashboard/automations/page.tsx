import PageContainer from '@/components/layout/page-container';
import { NotBuiltYet } from '@/components/layout/not-built-yet';

export const metadata = { title: 'Dashboard · Automations' };

export default function Page() {
  return (
    <PageContainer
      pageTitle='Automations'
      pageDescription='Role profiles and the auto-completion rules that read activity.'
    >
      <NotBuiltYet
        needs='Needs the rule engine and fired-count tracking on recurring_task; role_profile’s JSONB columns need typing first.'
        auditRef='§2.14'
      />
    </PageContainer>
  );
}
