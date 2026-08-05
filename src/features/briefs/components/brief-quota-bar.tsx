'use client';

import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { briefQuotaQueryOptions } from '../api/queries';

/**
 * Weekly brief-creation progress for one person (PRD §5.3).
 *
 * ⚠️ ONE SHARED FETCH. Every People row renders one of these, but they all read
 * the same TanStack cache entry, so N rows are still ONE request. Never call
 * `getBriefQuota` per row.
 *
 * ⚠️ RENDERS NOTHING when no role profile carries a `briefsPerWeek`. An
 * unconfigured quota is not a zero quota — a "0 / 0" bar reads as failure
 * against a target nobody set. Same rule per person: a role with no quota shows
 * nothing rather than an empty track.
 *
 * ⚠️ COUNTS `brief.submitted`, CHANGED FROM `brief.created` on 2026-08-06 — so this
 * column now shows briefs SUBMITTED. ⚠️ Not simply a smaller number: a brief
 * submitted this week may have been started in an earlier one, so the count can go
 * UP as well as down (measured: created 6/5, submitted 10/0 for the current week).
 * Decision 6 says the quota counts APPROVED briefs and Vision emits no such event,
 * so submissions are the closest measurable proxy; audit D9 flagged "created" as
 * measuring briefs STARTED, which is a different thing.
 *
 * ⚠️ Still never `brief.updated`: updates fire 278 times across 19 briefs, so
 * counting them would measure editing volume and present it as output.
 *
 * ⚠️ Attribution runs through `person_identity`, not `unified_event.person_id`
 * — the denormalised copy is still null on all 165 brief events (the one-UPDATE
 * backfill has not run since the Vision identities were linked). Reading the
 * column directly would show zero for everyone.
 */
export function BriefQuotaBar({ personId }: { personId: string }) {
  const { data } = useQuery(briefQuotaQueryOptions());

  if (!data?.configured) return null;

  const row = data.rows.find((r) => r.personId === personId);
  if (!row?.target) return null;

  const pct = Math.min(100, Math.round((row.submitted / row.target) * 100));
  const met = row.submitted >= row.target;

  return (
    <div
      className='flex w-24 flex-col gap-1'
      title={`${row.submitted} of ${row.target} briefs submitted this week (from Monday)`}
    >
      <div className='bg-muted h-1.5 w-full overflow-hidden rounded-full'>
        <div
          className={cn('h-full rounded-full', met ? 'bg-success' : 'bg-muted-foreground/60')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className='text-muted-foreground text-[11px] tabular-nums'>
        {row.submitted}/{row.target} briefs
      </span>
    </div>
  );
}
