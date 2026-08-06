import { notFound } from 'next/navigation';
import PageContainer from '@/components/layout/page-container';
import ExtractionDetailPage from '@/features/extraction/components/extraction-detail';
import { getExtractionDetail } from '@/features/extraction/api/service';
import { requireRouteAccess } from '@/lib/current-actor';

export const metadata = {
  title: 'Dashboard: Extraction Detail'
};

type PageProps = { params: Promise<{ id: string }> };

export default async function Page(props: PageProps) {
  // Resource-based check — see the note on the listing page. This one renders
  // the transcript's speakers and verbatim quotes from a real meeting.
  // ⚠️ Role gate + auth in one call. Redirects to the caller's own role home
  // rather than 403ing; the map is @/lib/route-access.
  await requireRouteAccess('/dashboard/extraction/[id]');

  const { id } = await props.params;
  const firefliesId = decodeURIComponent(id);

  // Read once on the server for the header text. The same query is prefetched
  // and hydrated below, so this does not cost a second round trip on render.
  const detail = await getExtractionDetail(firefliesId);
  if (!detail) notFound();

  return (
    <PageContainer
      pageTitle={detail.title ?? '(untitled meeting)'}
      pageDescription='Extracted action items. Each keeps the verbatim quote it came from — the only way to verify an item against what was said.'
    >
      <ExtractionDetailPage firefliesId={firefliesId} />
    </PageContainer>
  );
}
