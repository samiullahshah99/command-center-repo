'use client';

import Link from 'next/link';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format-date';
import type { IdentityBadge } from '../api/types';

/**
 * Connected-system badges — one per source, always all five, always in the same
 * order.
 *
 * ⚠️ ABSENT SOURCES STILL RENDER. A badge that disappears when unlinked would
 * make "no Slack account" indistinguishable from "we don't track Slack", and the
 * grey gap is the actual call to action — 17 of 19 identity rows on this data
 * belong to nobody. Every grey badge is a link into /dashboard/identities.
 *
 * ⚠️ Three states only. A fourth ("row exists but unclaimed") is impossible on a
 * person row — `person_identity_attribution_ck` forces `confidence` non-null
 * whenever `person_id` is set, so an unclaimed row has no person to hang under.
 * That count is shown once at the top of the board instead.
 */

const LABEL: Record<string, string> = {
  slack: 'Slack',
  clickup: 'ClickUp',
  vision: 'Vision',
  ugc: 'UGC',
  fireflies: 'Fireflies'
};

/** Two letters — the badge is 24px and a full word does not fit. */
const SHORT: Record<string, string> = {
  slack: 'Sl',
  clickup: 'Cu',
  vision: 'Vi',
  ugc: 'Ug',
  fireflies: 'Ff'
};

const STATE_STYLE: Record<IdentityBadge['state'], string> = {
  // Colour is used sparingly on this page: department pills do not exist, so
  // these three states and the items pill are the only saturated elements.
  linked_strong: 'bg-success-muted text-success-muted-foreground ring-success/20',
  linked_manual: 'bg-warning-muted text-warning-muted-foreground ring-warning/20',
  absent: 'bg-muted text-muted-foreground ring-border'
};

function tooltipFor(b: IdentityBadge, now: Date): string {
  if (b.state === 'absent') return `${LABEL[b.source]} — not linked. Open Identities to link it.`;
  const parts = [`${LABEL[b.source]} — linked`];
  if (b.confidence) parts.push(`confidence: ${b.confidence}`);
  if (b.linkedAt) parts.push(formatRelativeTime(b.linkedAt, now));
  // `linked_by` is only meaningful for a manual link — it names the human who
  // confirmed it, which is the whole reason 'manual' is a distinct tier.
  if (b.confidence === 'manual' && b.linkedBy) parts.push(`by ${b.linkedBy}`);
  if (b.count > 1) parts.push(`${b.count} accounts`);
  return parts.join(' · ');
}

export function IdentityBadges({
  identities,
  now,
  className
}: {
  identities: IdentityBadge[];
  /** The single per-request instant, threaded from the service. */
  now: Date;
  className?: string;
}) {
  return (
    <TooltipProvider>
      <div className={cn('flex items-center gap-1', className)}>
        {identities.map((b) => (
          <Tooltip key={b.source}>
            <TooltipTrigger
              render={
                // A real <a>: base-ui triggers expect a native interactive
                // element, and the grey state must be clickable to be an
                // affordance rather than a decoration.
                <Link
                  href='/dashboard/identities'
                  aria-label={tooltipFor(b, now)}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full text-[10px] font-medium ring-1 transition-opacity hover:opacity-80',
                    STATE_STYLE[b.state]
                  )}
                />
              }
            >
              {SHORT[b.source]}
            </TooltipTrigger>
            <TooltipContent>{tooltipFor(b, now)}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
