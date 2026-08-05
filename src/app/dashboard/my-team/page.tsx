import PageContainer from '@/components/layout/page-container';
import { NotBuiltYet } from '@/components/layout/not-built-yet';

export const metadata = { title: 'Dashboard · My team' };

export default function Page() {
  return (
    <PageContainer
      pageTitle='My team'
      pageDescription='Your team’s health, agent performance and shared action items.'
    >
      <NotBuiltYet
        needs='Needs a team scope on the department model, plus the Zendesk integration for agent performance.'
        auditRef='§2.11'
      />
    </PageContainer>
  );
}
