'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Icons } from '@/components/icons';
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

export function ActionItemCard({ item, index }: { item: ActionItemRow; index: number }) {
  const meta = OWNER_CONFIDENCE_META[item.ownerConfidence];
  const needsReview = NEEDS_REVIEW.includes(item.ownerConfidence);
  const due = formatDueDate(item.dueDate);

  return (
    <Card
      className={cn(
        'overflow-hidden',
        // A left rule rather than a full amber card: the page is a queue, and
        // tinting whole cards makes the ones needing attention harder to scan,
        // not easier.
        needsReview && 'border-l-amber-500/70 border-l-4'
      )}
    >
      <CardHeader className='gap-2 pb-3'>
        <div className='flex items-start justify-between gap-4'>
          <div className='flex items-start gap-2'>
            <span className='text-muted-foreground mt-0.5 font-mono text-xs'>
              {String(index + 1).padStart(2, '0')}
            </span>
            <h3 className='text-base leading-snug font-medium'>{item.description}</h3>
          </div>

          {/* The model's own estimate that this is a real commitment. Kept
              distinct from owner confidence — they answer different questions
              and conflating them was the thing to avoid. */}
          <div className='flex shrink-0 flex-col items-end'>
            <span className='text-muted-foreground text-[11px] tracking-wide uppercase'>
              model conf.
            </span>
            <span className='font-mono text-sm'>{item.confidence.toFixed(2)}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className='flex flex-col gap-4'>
        <div className='flex flex-wrap items-center gap-x-6 gap-y-2 text-sm'>
          <div className='flex items-center gap-2'>
            <Icons.user className='text-muted-foreground h-4 w-4' />
            <span className='font-medium'>{item.ownerName}</span>
            {item.ownerPersonName ? (
              <span className='text-muted-foreground'>→ {item.ownerPersonName}</span>
            ) : (
              <span className='text-muted-foreground italic'>not linked to a person</span>
            )}
            <Badge
              variant='outline'
              className={cn('text-[11px]', meta.className)}
              title={meta.hint}
            >
              {meta.label}
            </Badge>
          </div>

          <div className='flex items-center gap-2'>
            <Icons.calendar className='text-muted-foreground h-4 w-4' />
            <span className={cn(due.muted && 'text-muted-foreground italic')}>{due.label}</span>
          </div>
        </div>

        {item.followUps.length > 0 && (
          <ul className='text-muted-foreground list-inside list-disc text-sm'>
            {item.followUps.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}

        {/*
          ⚠️ THE MOST IMPORTANT ELEMENT ON THE PAGE.

          This is the verbatim transcript quote, and it is the only thing that
          lets a reviewer confirm the item against what was actually said.
          Without it they are approving the model's summary of a conversation
          they may not have been in — which is a rubber stamp, not a review.

          Quoted, indented and monospace so it reads as evidence rather than as
          more of the model's prose.
        */}
        <figure className='border-muted-foreground/30 bg-muted/40 border-l-2 py-2 pl-4'>
          <figcaption className='text-muted-foreground mb-1 text-[11px] tracking-wide uppercase'>
            said in the meeting
          </figcaption>
          <blockquote className='font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap'>
            &ldquo;{item.sourceSpan}&rdquo;
          </blockquote>
        </figure>

        {/* Approve / reject sits BELOW the quote, never above it. The reviewer's
            job is to check the item against what was said; putting the decision
            buttons first invites deciding before reading. */}
        <ReviewActions item={item} />
      </CardContent>
    </Card>
  );
}
