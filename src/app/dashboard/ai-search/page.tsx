import PageContainer from '@/components/layout/page-container';
import { NotBuiltYet } from '@/components/layout/not-built-yet';

export const metadata = { title: 'Dashboard · AI search' };

export default function Page() {
  return (
    <PageContainer
      pageTitle='AI search'
      pageDescription='Ask across the portal, meeting transcripts, Slack and Notion.'
    >
      <NotBuiltYet
        needs='Needs a retrieval layer with role-filtered sources — a hard requirement, not a UI filter.'
        auditRef='§2.9'
      />
    </PageContainer>
  );
}
