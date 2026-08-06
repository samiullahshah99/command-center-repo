'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { SampleDataCaption } from '@/components/sample-data-caption';
import { LABEL_CAPS, Panel, Screen, StatCard, TagPill } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { founderOffloadQueryOptions } from '../api/queries';
import type { FounderOffload, OffloadStatus } from '../api/types';

/**
 * Founder task offload.
 *
 * ⚠️⚠️ THE FIRST FULLY SAMPLE-BACKED SCREEN IN THE BUILD. Every other mocked
 * surface so far has been one widget sitting on a page of real data; here there
 * is no real half at all, because the offload model does not exist (audit §2.8 —
 * no table, and `source_type` has no `founder_offload` value).
 *
 * ⚠️ That is why the caption sits ABOVE THE STATS rather than inside the table
 * card. The stats are derived from the same invented rows, so a caption placed
 * below them would leave three fabricated numbers sitting above their own
 * disclaimer — which is exactly the reading someone takes a screenshot of.
 */
export function FounderOffloadBody() {
  const { data } = useSuspenseQuery(founderOffloadQueryOptions());

  return (
    <Screen width='narrow'>
      <div>
        <h1 className='text-[21px] leading-none font-bold tracking-[-0.01em]'>
          Founder task offload
        </h1>
        <p className='text-muted-foreground mt-[6px] max-w-[760px] text-[13px] leading-[1.5]'>
          Damian surfaces a task → Ardin assigns an owner → tracked here until verifiably handed
          off.
        </p>
      </div>

      {/*
        ⚠️ ONE caption, at screen level, governing everything below it — not one
        per row. Rendered from the DTO's own flag, so it disappears on its own if
        this service ever returns real rows.
      */}
      {data.isSample && (
        <SampleDataCaption
          className='text-muted-foreground text-[12px]'
          what='the offload model is unbuilt (audit §2.8); this preview shows the intended workflow.'
        />
      )}

      <StatRow data={data} />
      <OffloadTable data={data} />
    </Screen>
  );
}

function StatRow({ data }: { data: FounderOffload }) {
  return (
    <div className='grid gap-[14px] sm:grid-cols-3'>
      {/* Zero is DATA and renders as 0 — StatCard has no dash fallback by design. */}
      <StatCard size='md' label='Proposed' value={data.stats.proposed} sub='awaiting an owner' />
      <StatCard
        size='md'
        label='In transition'
        value={data.stats.inTransition}
        sub='assigned, not yet clear of Damian'
      />
      <StatCard
        size='md'
        label='Handed off'
        value={data.stats.handedOff}
        sub='running without him'
      />
    </div>
  );
}

/**
 * ⚠️ TONE IS NOT SEVERITY HERE. `proposed` is muted rather than destructive: a
 * task nobody owns yet is the NORMAL first stage of this workflow, not a failure.
 * Colouring it red would put alarm on every task the moment Damian surfaces it,
 * which would train people to ignore the colour.
 */
const STATUS_META: Record<
  OffloadStatus,
  { label: string; tone: 'muted' | 'warning' | 'success'; title: string }
> = {
  proposed: {
    label: 'Proposed',
    tone: 'muted',
    title: 'Surfaced by the founder; no owner named yet'
  },
  assigned: {
    label: 'Assigned',
    tone: 'warning',
    title: 'An owner is named, but the work has not moved yet'
  },
  in_transition: {
    label: 'In transition',
    tone: 'warning',
    title: 'The owner is doing it with the founder still involved'
  },
  handed_off: {
    label: 'Handed off',
    tone: 'success',
    title: 'Running without the founder'
  }
};

const COLS = 'grid-cols-[1.6fr_0.7fr_0.6fr_0.8fr]';

function OffloadTable({ data }: { data: FounderOffload }) {
  return (
    <Panel title={`Offload queue · ${data.rows.length}`}>
      {data.rows.length === 0 ? (
        <p className='text-muted-foreground text-[12.5px]'>Nothing on the offload queue.</p>
      ) : (
        <div className='overflow-x-auto'>
          <div className='min-w-[620px]'>
            <div className={cn(LABEL_CAPS, 'grid gap-[10px] border-b pb-[7px]', COLS)}>
              <span>Task</span>
              <span>Proposed owner</span>
              <span className='text-right'>Time/wk</span>
              <span>Status</span>
            </div>

            {data.rows.map((r) => {
              const meta = STATUS_META[r.status];
              return (
                <div
                  key={r.id}
                  className={cn(
                    'grid items-center gap-[10px] border-b py-[9px] last:border-b-0',
                    COLS
                  )}
                >
                  <span className='flex min-w-0 flex-col gap-[2px]'>
                    <span className='truncate text-[13px] font-semibold'>{r.task}</span>
                    <span className='text-muted-foreground truncate text-[11.5px]'>{r.note}</span>
                  </span>

                  {/*
                    ⚠️ A real stage, not missing data — the workflow's first step is
                    Damian surfacing a task before Ardin names anyone. Italic and
                    muted so it reads as "not yet", not as a failed lookup.
                  */}
                  <span
                    className={cn(
                      'min-w-0 truncate text-[12.5px]',
                      r.ownerName ? '' : 'text-muted-foreground italic'
                    )}
                  >
                    {r.ownerName ?? 'Unassigned'}
                  </span>

                  <span className='text-muted-foreground text-right text-[12.5px] tabular-nums'>
                    {r.hoursPerWeek}h
                  </span>

                  <span>
                    <TagPill tone={meta.tone} title={meta.title}>
                      {meta.label}
                    </TagPill>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className='text-muted-foreground border-t pt-[10px] text-[11.5px] leading-[1.45]'>
        A task is only &ldquo;handed off&rdquo; on evidence that it ran without the founder — never
        on a self-declared check-off.
      </p>
    </Panel>
  );
}
