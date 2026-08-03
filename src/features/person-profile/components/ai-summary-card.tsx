'use client';

import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { formatMeetingDate } from '@/lib/format-date';
import { regenerateSummaryMutation } from '../api/mutations';
import type { PersonProfile } from '../api/types';

/**
 * The headline card.
 *
 * ⚠️ DOUBLE-LABELLED, same discipline as the approved mockup: a "GENERATED"
 * chip at the top and an explicit caveat in the footer. The prose is written to
 * be faithful to real data, which makes it MORE likely to be read as
 * authoritative — so the labelling is the safeguard, not decoration.
 *
 * ⚠️ The page must be fully useful with this card ABSENT. A parse failure, a
 * provider outage, or a person with nothing tracked all render a quiet notice
 * plus a regenerate affordance — never a broken page, and never a fabricated
 * summary standing in for missing data.
 */
export function AiSummaryCard({
  personId,
  personName,
  summary,
  unavailable
}: {
  personId: string;
  personName: string;
  summary: PersonProfile['summary'];
  unavailable: PersonProfile['summaryUnavailable'];
}) {
  const m = useMutation(regenerateSummaryMutation);

  // Nothing tracked — a truthful statement, and the LLM was never called.
  if (unavailable === 'no_data') {
    return (
      <Card>
        <CardContent className='text-muted-foreground py-8 text-center text-sm'>
          Nothing currently tracked for {personName}.
        </CardContent>
      </Card>
    );
  }

  if (!summary) {
    return (
      <Card className='border-dashed'>
        <CardContent className='flex flex-wrap items-center gap-3 py-6'>
          <span className='text-muted-foreground text-sm'>
            Summary unavailable right now. Everything below is unaffected.
          </span>
          <RegenerateButton personId={personId} mutation={m} className='ml-auto' />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className='border-violet-500/30 bg-gradient-to-br from-violet-500/[0.07] to-transparent'>
      <CardContent className='flex flex-col gap-3 pt-6'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='flex size-6 items-center justify-center rounded-md bg-violet-500/15'>
            <Icons.sun className='size-3.5 text-violet-600 dark:text-violet-400' />
          </span>
          <h3 className='text-sm font-semibold'>Summary</h3>
          <span className='rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-violet-700 uppercase dark:text-violet-300'>
            AI generated
          </span>
          <RegenerateButton personId={personId} mutation={m} className='ml-auto' />
        </div>

        <p className='text-sm leading-relaxed'>{summary.summary}</p>

        <p className='text-muted-foreground/80 border-t pt-2.5 text-[11px]'>
          AI-generated from tracked items and activity, may be imperfect. Built from{' '}
          {summary.itemCount} item{summary.itemCount === 1 ? '' : 's'} and {summary.eventCount}{' '}
          activity event{summary.eventCount === 1 ? '' : 's'} · generated{' '}
          {formatMeetingDate(summary.generatedAt)}
          {summary.cached && ' · cached'}
        </p>

        {m.data && !m.data.ok && <p className='text-destructive text-[11px]'>{m.data.message}</p>}
      </CardContent>
    </Card>
  );
}

function RegenerateButton({
  personId,
  mutation,
  className
}: {
  personId: string;
  mutation: ReturnType<typeof useMutation<unknown, Error, string>>;
  className?: string;
}) {
  return (
    <Button
      variant='ghost'
      size='sm'
      className={className}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate(personId)}
    >
      {mutation.isPending ? (
        <>
          <Icons.spinner className='mr-1.5 size-3.5 animate-spin' />
          Regenerating…
        </>
      ) : (
        <>
          <Icons.settings className='mr-1.5 size-3.5' />
          Regenerate
        </>
      )}
    </Button>
  );
}
