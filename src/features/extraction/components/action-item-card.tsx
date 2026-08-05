'use client';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { ROW_TITLE, TagPill } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import {
  formatDateOnly,
  NEEDS_REVIEW,
  OWNER_CONFIDENCE_META
} from '../constants/extraction-options';
import type { ActionItemRow } from '../api/types';
import { ReviewActions } from './review-actions';

function formatDueDate(due: string | null): { label: string; muted: boolean } {
  if (!due) {
    // Explicit, never blank. A missing date and an undated commitment look
    // identical in an empty cell, and only one of them is correct behaviour —
    // the model is told to return null rather than invent a deadline.
    return { label: 'no date', muted: true };
  }
  // formatDateOnly pins BOTH locale and timezone. This previously passed
  // `undefined` as the locale, which resolves per-host and produced a
  // server/client hydration mismatch — the same fault that blanked the meeting
  // table's rows. See the note in constants/extraction-options.ts.
  return { label: formatDateOnly(due), muted: false };
}

/**
 * One proposed action item, awaiting a human decision.
 *
 * Styled to the Review queue card of the Capture queue screen in
 * `docs/design-reference/Command_Center_dc.html`: 13px title row with a pill on
 * the right, then the quote, then a 11.5px meta strip carrying owner, due date
 * and the decision buttons.
 *
 * ⚠️ ONE DELIBERATE DEPARTURE FROM THE MOCK: it renders the quote as a small
 * muted italic line, almost an afterthought. Ours keeps it as a bordered
 * monospace evidence block. That is not a styling preference — `source_span` is
 * the only thing that lets a reviewer confirm the item against what was actually
 * said, and CLAUDE.md makes it mandatory for exactly that reason. De-emphasise
 * it and the review step becomes a rubber stamp that adds latency and no safety.
 * Everything else on this card follows the mock.
 */
export function ActionItemCard({ item, index }: { item: ActionItemRow; index: number }) {
  const meta = OWNER_CONFIDENCE_META[item.ownerConfidence];
  const needsReview = NEEDS_REVIEW.includes(item.ownerConfidence);
  const due = formatDueDate(item.dueDate);

  return (
    <Card
      className={cn(
        'gap-[10px] overflow-hidden p-[14px_16px]',
        // A left rule rather than a full amber card: the page is a queue, and
        // tinting whole cards makes the ones needing attention harder to scan,
        // not easier. Token, not `amber-500` — a hardcoded palette value renders
        // a light rule against a dark surface.
        needsReview && 'border-l-warning border-l-4'
      )}
    >
      <div className='flex items-start gap-[8px]'>
        <span className='text-muted-foreground/70 mt-[2px] font-mono text-[11px] tabular-nums'>
          {String(index + 1).padStart(2, '0')}
        </span>
        <h3 className={cn(ROW_TITLE, 'flex-1')}>{item.description}</h3>

        {/*
          The model's own estimate that this is a real commitment. Kept distinct
          from owner confidence — they answer different questions, and conflating
          them was the thing to avoid.

          ⚠️ Neutral, never green. The mock tints this pill emerald, which reads
          as "verified" for what is only the model's self-report. High confidence
          in a hallucination is still a hallucination, and the reviewer is here
          precisely because that number cannot be trusted on its own.
        */}
        <TagPill className='mt-px' title='Model confidence this is a real commitment'>
          {Math.round(item.confidence * 100)}%
        </TagPill>
      </div>

      {item.followUps.length > 0 && (
        <ul className='text-muted-foreground list-inside list-disc text-[12px]'>
          {item.followUps.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      {/*
        ⚠️ THE MOST IMPORTANT ELEMENT ON THE CARD.

        The verbatim transcript quote — the only thing that lets a reviewer
        confirm the item against what was actually said. Without it they are
        approving the model's summary of a conversation they may not have been
        in, which is a rubber stamp, not a review.

        Quoted, inset and monospace so it reads as evidence rather than as more
        of the model's prose.
      */}
      <figure className='border-muted-foreground/30 bg-muted/40 rounded-r-[8px] border-l-2 py-[8px] pr-[10px] pl-[12px]'>
        <figcaption className='text-muted-foreground mb-[3px] text-[10.5px] font-semibold tracking-[0.06em] uppercase'>
          said in the meeting
        </figcaption>
        <blockquote className='font-mono text-[12.5px] leading-[1.6] break-words whitespace-pre-wrap'>
          &ldquo;{item.sourceSpan}&rdquo;
        </blockquote>
      </figure>

      {/*
        The mock's meta strip: owner, date, then actions pushed right.
        Approve / reject sit BELOW the quote, never above it. The reviewer's job
        is to check the item against what was said; putting the decision buttons
        first invites deciding before reading.
      */}
      <div className='flex flex-wrap items-center gap-x-[12px] gap-y-[8px] text-[11.5px]'>
        <span className='flex items-center gap-[6px]'>
          <Icons.user className='text-muted-foreground size-[13px]' />
          <span className='font-semibold'>{item.ownerName}</span>
          {item.ownerPersonName ? (
            <span className='text-muted-foreground'>→ {item.ownerPersonName}</span>
          ) : (
            <span className='text-muted-foreground italic'>not linked</span>
          )}
          <Badge
            variant='outline'
            className={cn('rounded-full px-[7px] py-px text-[10.5px]', meta.className)}
            title={meta.hint}
          >
            {meta.label}
          </Badge>
        </span>

        <span className='flex items-center gap-[6px]'>
          <Icons.calendar className='text-muted-foreground size-[13px]' />
          <span className={cn(due.muted && 'text-muted-foreground italic')}>{due.label}</span>
        </span>

        <span className='flex-1' />

        <ReviewActions item={item} />
      </div>
    </Card>
  );
}
