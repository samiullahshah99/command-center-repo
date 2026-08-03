'use client';

import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { extractionDetailOptions, extractionStatusOptions } from '../api/queries';
import { formatDuration, formatMeetingDate, NEEDS_REVIEW } from '../constants/extraction-options';
import { ActionItemCard } from './action-item-card';

const POLL_MS = 2_000;
const POLL_TIMEOUT_MS = 3 * 60_000;

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
    <div className='flex flex-col gap-6'>
      <Card>
        <CardContent className='flex flex-col gap-3 pt-6'>
          <div className='flex flex-wrap items-center gap-x-6 gap-y-2 text-sm'>
            <span className='flex items-center gap-2'>
              <Icons.calendar className='text-muted-foreground h-4 w-4' />
              {formatMeetingDate(view.date)}
            </span>
            <span className='flex items-center gap-2'>
              <Icons.clock className='text-muted-foreground h-4 w-4' />
              {formatDuration(view.durationSeconds)}
            </span>
            <span className='text-muted-foreground'>{view.sentenceCount} sentences</span>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-muted-foreground text-sm'>Speakers:</span>
            {view.speakers.length > 0 ? (
              view.speakers.map((s) => (
                <Badge key={s} variant='secondary' className='text-xs'>
                  {s}
                </Badge>
              ))
            ) : (
              <span className='text-muted-foreground text-sm italic'>none recorded</span>
            )}
          </div>
        </CardContent>
      </Card>

      {status.data?.state === 'failed' ? (
        <Card className='border-destructive/40'>
          <CardContent className='pt-6'>
            <p className='text-destructive text-sm font-medium'>Extraction failed</p>
            <p className='text-muted-foreground mt-1 text-sm'>{status.data.message}</p>
          </CardContent>
        </Card>
      ) : view.pending && status.data?.state !== 'complete_empty' ? (
        <Card>
          <CardContent className='flex items-center gap-3 pt-6'>
            <Icons.spinner className='text-muted-foreground h-4 w-4 animate-spin' />
            <span className='text-muted-foreground text-sm'>
              Extracting action items… this takes a few seconds.
            </span>
          </CardContent>
        </Card>
      ) : view.items.length === 0 ? (
        // ⚠️ Zero is a VALID, CORRECT result — plenty of meetings contain no
        // commitments at all, and the extractor is explicitly instructed to
        // return nothing rather than invent items to look useful. Worded and
        // styled so it cannot be read as a failure.
        <Card>
          <CardContent className='flex flex-col items-center gap-2 py-12 text-center'>
            <Icons.circleCheck className='text-muted-foreground h-8 w-8' />
            <p className='font-medium'>No action items found in this transcript</p>
            <p className='text-muted-foreground max-w-md text-sm'>
              The extraction ran successfully and found no commitments. That is a normal result for
              a discussion, a retro, or a status update.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className='flex items-center justify-between'>
            <h2 className='text-lg font-semibold'>
              {view.items.length} action item{view.items.length === 1 ? '' : 's'}
            </h2>
            {needsReviewCount > 0 && (
              <Badge
                variant='outline'
                className='border-amber-500/50 bg-amber-500/15 font-semibold text-amber-800 dark:text-amber-200'
              >
                {needsReviewCount} need{needsReviewCount === 1 ? 's' : ''} owner review
              </Badge>
            )}
          </div>

          <div className='flex flex-col gap-4'>
            {view.items.map((item, i) => (
              <ActionItemCard key={item.id} item={item} index={i} />
            ))}
          </div>

          {/* Approve/reject are live here; the FULL review queue — filtering,
              bulk actions, keyboard flow — is still a later increment. */}
          <p className='text-muted-foreground border-t pt-4 text-xs'>
            Approving promotes an item to the tracker board. The full review queue, with filtering
            and bulk actions, arrives in a later increment.
          </p>
        </>
      )}
    </div>
  );
}
