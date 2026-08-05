import PageContainer from '@/components/layout/page-container';
import { NotBuiltYet } from '@/components/layout/not-built-yet';

export const metadata = { title: 'Dashboard · Founder offload' };

export default function Page() {
  return (
    <PageContainer
      pageTitle='Founder offload'
      pageDescription='Tasks moving off the founder’s plate, tracked until verifiably handed off.'
    >
      <NotBuiltYet
        needs='Needs a dedicated offload model sharing an evidence contract with the completion ledger.'
        auditRef='§2.8'
      />
    </PageContainer>
  );
}
