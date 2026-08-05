'use client';

import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { EmptyState, Panel, Screen, SectionLabel, TagPill } from '@/components/ui/panel';
import { extractionDetailOptions, extractionStatusOptions } from '../api/queries';
import { formatDuration, formatMeetingDate, NEEDS_REVIEW } from '../constants/extraction-options';
import { ActionItemCard } from './action-item-card';

const POLL_MS = 2_000;
const POLL_TIMEOUT_MS = 3 * 60_000;

/**
 * One meeting's extracted action items, awaiting review.
 *
 * Laid out to the Capture queue screen of
 * `docs/design-reference/Command_Center_dc.html` — a meeting-context strip, then
 * the review queue.
 *
 * ⚠️ THE MOCK'S TWO INGEST CARDS ARE NOT BUILT, and should not be. It shows
 * "Slack MCP" and "Fireflies transcript" panels with an *Ingest* button that
 * fabricates a message and a transcript on click. That is a demo affordance:
 * real ingestion is an inbound webhook (verify → persist `raw_event` → enqueue),
 * and a button that manufactures a fake transcript would write invented content
 * into the same table that real deliveries land in — indistinguishable from real
 * data the moment anyone looks at the row.
 *
 * ⚠️ THE MOCK'S "SYNCED TO CLICKUP" SECTION IS ALSO NOT BUILT. Superseded by the
 * 2026-08-04 amendment: the Command Centre is the task system of record and no
 * external task tool is written to. Approving promotes to `tracked_item`.
 */
export function ExtractionDetailView({ firefliesId }: { firefliesId: string }) {
  // ── The progress mechanism, half one ──────────────────────────────────────
  // The DETAIL query polls itself while the meeting is stored but has no items,
  // so the cards appear on their own the moment extraction writes them.
  //
  // ⚠️ It has to be this query that polls, not a second one. An earlier cut used
  // a separate useQuery on the same queryKey to "pull in" the finished result —
  // but two hooks sharing a key share one cache entry, so the second one's
  // `enabled` did nothing and the items never arrived without a manual refresh.
  const { data: view } = useSuspenseQuery({
    ...extractionDetailOptions(firefliesId),
    refetchInterval: (query) =>
      query.state.data?.pending && query.state.dataUpdateCount * POLL_MS < POLL_TIMEOUT_MS
        ? POLL_MS
        : false
  });

  // ── Half two ──────────────────────────────────────────────────────────────
  // `pending` alone cannot tell "still running" from "ran and found nothing" —
  // both are zero rows. Only pg-boss knows, so the status query resolves the
  // ambiguity and is the sole reason the empty case does not spin forever.
  const status = useQuery({
    ...extractionStatusOptions(firefliesId),
    enabled: Boolean(view?.pending),
    refetchInterval: (query) => {
      const s = query.state.data?.state;
      if (s === 'complete' || s === 'complete_empty' || s === 'failed') return false;
      if (query.state.dataUpdateCount * POLL_MS > POLL_TIMEOUT_MS) return false;
      return POLL_MS;
    }
  });

  if (!view) return null;

  const needsReviewCount = view.items.filter((i) =>
    NEEDS_REVIEW.includes(i.ownerConfidence)
  ).length;

  return (
    <Screen>
      {/* Meeting context strip — the mock's card header row, one line. */}
      <Panel>
        <div className='flex flex-wrap items-center gap-x-[18px] gap-y-[8px] text-[12.5px]'>
          <span className='flex items-center gap-[6px]'>
            <Icons.calendar className='text-muted-foreground size-[14px]' />
            {formatMeetingDate(view.date)}
          </span>
          <span className='flex items-center gap-[6px]'>
            <Icons.clock className='text-muted-foreground size-[14px]' />
            {formatDuration(view.durationSeconds)}
          </span>
          <span className='text-muted-foreground'>{view.sentenceCount} sentences</span>
        </div>

        <div className='flex flex-wrap items-center gap-[6px]'>
          <span className='text-muted-foreground text-[11.5px]'>Speakers</span>
          {view.speakers.length > 0 ? (
            view.speakers.map((s) => <TagPill key={s}>{s}</TagPill>)
          ) : (
            <span className='text-muted-foreground text-[11.5px] italic'>none recorded</span>
          )}
        </div>
      </Panel>

      {status.data?.state === 'failed' ? (
        <Card className='border-destructive/40 gap-[6px] p-[18px]'>
          <p className='text-destructive text-[13px] font-semibold'>Extraction failed</p>
          <p className='text-muted-foreground text-[12.5px]'>{status.data.message}</p>
        </Card>
      ) : view.pending && status.data?.state !== 'complete_empty' ? (
        <Card className='flex-row items-center gap-[10px] p-[18px]'>
          <Icons.spinner className='text-muted-foreground size-4 animate-spin' />
          <span className='text-muted-foreground text-[12.5px]'>
            Extracting action items… this takes a few seconds.
          </span>
        </Card>
      ) : view.items.length === 0 ? (
        // ⚠️ Zero is a VALID, CORRECT result — plenty of meetings contain no
        // commitments at all, and the extractor is explicitly instructed to
        // return nothing rather than invent items to look useful. Worded and
        // styled so it cannot be read as a failure.
        <Panel>
          <EmptyState
            icon={<Icons.circleCheck className='size-5' />}
            title='No action items found in this transcript'
            detail='The extraction ran successfully and found no commitments. That is a normal result for a discussion, a retro, or a status update.'
          />
        </Panel>
      ) : (
        <section>
          <div className='mb-[10px] flex items-center gap-[10px]'>
            <SectionLabel className='mb-0 flex-1'>
              Review queue · {view.items.length} item{view.items.length === 1 ? '' : 's'}
            </SectionLabel>
            {needsReviewCount > 0 && (
              <TagPill tone='warning'>
                {needsReviewCount} need{needsReviewCount === 1 ? 's' : ''} owner review
              </TagPill>
            )}
          </div>

          <div className='flex flex-col gap-[12px]'>
            {view.items.map((item, i) => (
              <ActionItemCard key={item.id} item={item} index={i} />
            ))}
          </div>

          {/* Approve/reject are live here; the FULL review queue — filtering,
              bulk actions, keyboard flow — is still a later increment. */}
          <p className='text-muted-foreground mt-[14px] border-t pt-[12px] text-[11.5px]'>
            Approving promotes an item to the tracker board. The full review queue, with filtering
            and bulk actions, arrives in a later increment.
          </p>
        </section>
      )}
    </Screen>
  );
}
