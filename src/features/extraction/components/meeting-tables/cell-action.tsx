'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { fetchAndExtractMutation } from '../../api/mutations';
import { extractionStatusOptions } from '../../api/queries';
import type { FetchExtractResult, MeetingRow } from '../../api/types';

/**
 * How long the UI keeps asking whether extraction has finished.
 *
 * The measured run for a 57-minute meeting is ~15s end to end. 2s is frequent
 * enough that the row does not look stuck and cheap enough that it costs one
 * indexed query per tick — no model calls, no Fireflies calls.
 */
const POLL_MS = 2_000;

/** Give up polling after this. A stuck row must not poll forever in a tab. */
const POLL_TIMEOUT_MS = 3 * 60_000;

export function CellAction({ data }: { data: MeetingRow }) {
  const router = useRouter();
  const mutation = useMutation(fetchAndExtractMutation);

  // ── The progress mechanism ────────────────────────────────────────────────
  // Enabled only once a fetch has been kicked off from this row, or the row
  // already shows a stored-but-not-yet-extracted meeting. Polling every row
  // unconditionally would put 25 queries on a 2s loop for a page that is mostly
  // static.
  const started = mutation.isSuccess && mutation.data.ok;
  const shouldWatch = started || data.status === 'pending';

  const status = useQuery({
    ...extractionStatusOptions(data.firefliesId),
    enabled: shouldWatch,
    refetchInterval: (query) => {
      const s = query.state.data?.state;
      // Stop the moment the job settles, in EITHER direction. 'complete_empty'
      // is a settled, correct outcome — a meeting with no commitments — and
      // treating it as "still waiting" would spin forever on a valid result.
      if (s === 'complete' || s === 'complete_empty' || s === 'failed') return false;
      if (query.state.dataUpdateCount * POLL_MS > POLL_TIMEOUT_MS) return false;
      return POLL_MS;
    }
  });

  const result: FetchExtractResult | undefined = mutation.data;

  // ── A known constraint, not an error ──────────────────────────────────────
  // Rendered as a plain inline note rather than a destructive alert: the list
  // endpoint is not plan-gated but transcript(id:) is, so this meeting is
  // genuinely visible and genuinely unopenable. That is a billing fact, and
  // styling it like a crash would misreport it.
  if (result && !result.ok) {
    const isPlan = result.reason === 'plan';
    return (
      <div className='flex flex-col items-end gap-1 text-right'>
        <span className={isPlan ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'}>
          {isPlan ? 'Not available on the current Fireflies plan' : result.message}
        </span>
        {isPlan && (
          <span className='text-muted-foreground/70 text-[11px]'>
            Known constraint — upgrade pending
          </span>
        )}
      </div>
    );
  }

  if (shouldWatch) {
    const s = status.data?.state;

    if (s === 'failed') {
      return (
        <div className='flex flex-col items-end gap-1 text-right'>
          <span className='text-destructive text-xs'>Extraction failed</span>
          <span className='text-muted-foreground/70 max-w-[22rem] truncate text-[11px]'>
            {status.data?.message}
          </span>
        </div>
      );
    }

    if (s === 'complete' || s === 'complete_empty') {
      return <ViewButton firefliesId={data.firefliesId} itemCount={status.data?.itemCount ?? 0} />;
    }

    return (
      <div className='flex items-center justify-end gap-2'>
        <Icons.spinner className='text-muted-foreground h-4 w-4 animate-spin' />
        <span className='text-muted-foreground text-xs'>Extracting…</span>
      </div>
    );
  }

  if (data.status === 'extracted' || data.status === 'extracted_empty') {
    return <ViewButton firefliesId={data.firefliesId} itemCount={data.itemCount} />;
  }

  return (
    <div className='flex justify-end'>
      <Button
        size='sm'
        variant='outline'
        disabled={mutation.isPending}
        onClick={() =>
          mutation.mutate(data.firefliesId, {
            onSuccess: (r) => {
              // Refresh the server component so the row's own status is right
              // if the user navigates back before the poll settles.
              if (r.ok) router.refresh();
            }
          })
        }
      >
        {mutation.isPending ? (
          <>
            <Icons.spinner className='mr-2 h-4 w-4 animate-spin' />
            Fetching…
          </>
        ) : (
          <>
            <Icons.checks className='mr-2 h-4 w-4' />
            Fetch &amp; Extract
          </>
        )}
      </Button>
    </div>
  );
}

function ViewButton({ firefliesId, itemCount }: { firefliesId: string; itemCount: number }) {
  const router = useRouter();
  return (
    <div className='flex items-center justify-end gap-3'>
      {itemCount === 0 && (
        // Explicit, and deliberately not styled as a problem. Zero action items
        // is a correct answer for plenty of meetings.
        <span className='text-muted-foreground text-xs'>no action items found</span>
      )}
      <Button
        size='sm'
        variant='outline'
        onClick={() => router.push(`/dashboard/extraction/${encodeURIComponent(firefliesId)}`)}
      >
        View
        <Icons.chevronRight className='ml-1 h-4 w-4' />
      </Button>
    </div>
  );
}
