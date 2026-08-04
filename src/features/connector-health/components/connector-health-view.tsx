'use client';

import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format-date';
import { connectorHealthQueryOptions } from '../api/queries';
import { CADENCE_NOTE, SOURCE_LABEL } from '../constants/thresholds';
import type { ConnectorRow } from '../api/types';

/**
 * Connector health. READ-ONLY — there are no actions on this page and it must
 * never gain one; it is a window onto raw_event and pgboss.job.
 */
export function ConnectorHealthView() {
  const { data } = useSuspenseQuery(connectorHealthQueryOptions());

  /**
   * ⚠️ ONE `now` for the whole page, from the SERVER's value. Every relative
   * label and every staleness comparison uses it. `new Date()` per card would
   * differ between SSR and hydration and React would discard the subtree.
   */
  const now = useMemo(() => new Date(data.now), [data.now]);

  return (
    <div className='flex flex-col gap-4'>
      <HeaderStrip
        eventsToday={data.eventsToday}
        jobsFailed={data.jobsFailed}
        deadLettered={data.deadLettered}
        unprocessedCount={data.unprocessedCount}
        oldestUnprocessedAt={data.oldestUnprocessedAt}
        now={now}
      />

      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
        {data.sources.map((s) => (
          <SourceCard key={s.source} row={s} now={now} />
        ))}
      </div>

      {/*
        The honesty caption, stated once for the whole page rather than repeated
        per card. It is the most important sentence here: nothing on this page
        measures webhook subscription health, because no provider exposes it.
      */}
      <p className='text-muted-foreground max-w-3xl text-xs'>
        Webhook subscription health is <strong>not queryable</strong> — no provider offers an
        endpoint that answers &ldquo;is my subscription still alive?&rdquo;. &ldquo;Last event
        received&rdquo; is the honest proxy: a silent source and a broken subscription look
        identical from here. Freshness thresholds are per source, because Vision emits tens of
        events a day while ClickUp can legitimately be quiet for a fortnight.
      </p>
    </div>
  );
}

function HeaderStrip({
  eventsToday,
  jobsFailed,
  deadLettered,
  unprocessedCount,
  oldestUnprocessedAt,
  now
}: {
  eventsToday: number;
  jobsFailed: number;
  deadLettered: number;
  unprocessedCount: number;
  oldestUnprocessedAt: string | null;
  now: Date;
}) {
  return (
    <Card>
      <CardContent className='grid gap-4 py-4 sm:grid-cols-3'>
        <Stat label='Events today' value={String(eventsToday)} />
        <Stat
          label='Jobs failed · 7d'
          value={String(jobsFailed)}
          tone={jobsFailed > 0 ? 'bad' : undefined}
          note={deadLettered > 0 ? `${deadLettered} dead-lettered` : undefined}
        />
        {/*
          The single most useful number here. A growing age means the worker is
          not draining; zero unprocessed means ingestion and normalisation are
          keeping up, which is why the healthy state says so explicitly rather
          than rendering an empty slot.
        */}
        <Stat
          label='Oldest unprocessed'
          value={oldestUnprocessedAt ? formatRelativeTime(oldestUnprocessedAt, now) : 'none'}
          tone={oldestUnprocessedAt ? 'warn' : undefined}
          note={
            oldestUnprocessedAt
              ? `${unprocessedCount} awaiting normalisation`
              : 'all events normalised'
          }
        />
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
  note
}: {
  label: string;
  value: string;
  tone?: 'bad' | 'warn';
  note?: string;
}) {
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='text-muted-foreground text-xs'>{label}</span>
      <span
        className={cn(
          'text-2xl leading-none font-medium tabular-nums',
          tone === 'bad' && 'text-red-600',
          tone === 'warn' && 'text-amber-700'
        )}
      >
        {value}
      </span>
      {note && <span className='text-muted-foreground text-[11px]'>{note}</span>}
    </div>
  );
}

function SourceCard({ row, now }: { row: ConnectorRow; now: Date }) {
  const { queue } = row;

  // Red for something that BROKE and has a fix; amber for something still in
  // flight. Staleness is deliberately neither — see constants/thresholds.ts.
  const indicator =
    queue.failed > 0 ? 'bad' : queue.retry > 0 ? 'warn' : row.lastEventAt ? 'ok' : 'idle';

  const ageHours = row.lastEventAt
    ? (now.getTime() - new Date(row.lastEventAt).getTime()) / 3600_000
    : null;
  const isQuiet = ageHours !== null && ageHours > row.staleAfterHours;

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <span
            aria-hidden
            className={cn(
              'size-2 shrink-0 rounded-full',
              indicator === 'bad' && 'bg-red-500',
              indicator === 'warn' && 'bg-amber-500',
              indicator === 'ok' && 'bg-emerald-500',
              indicator === 'idle' && 'bg-slate-300'
            )}
          />
          {SOURCE_LABEL[row.source]}
          {queue.failed > 0 && (
            <Badge variant='outline' className='border-red-200 bg-red-50 text-xs text-red-700'>
              {queue.failed} failed
            </Badge>
          )}
          {queue.retry > 0 && (
            <Badge
              variant='outline'
              className='border-amber-200 bg-amber-50 text-xs text-amber-800'
            >
              {queue.retry} retrying
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className='flex flex-col gap-3'>
        {/* Last event received — the proxy, labelled as such. */}
        <div className='flex flex-col gap-0.5'>
          <span className='text-muted-foreground text-xs'>Last event received</span>
          {row.lastEventAt ? (
            <span className={cn('text-sm', isQuiet && 'text-amber-700')}>
              {formatRelativeTime(row.lastEventAt, now)}
              {isQuiet && (
                <span className='text-muted-foreground'>
                  {' '}
                  · quiet beyond {row.staleAfterHours}h
                </span>
              )}
            </span>
          ) : (
            // "Never" is a distinct fact from "quiet" and must not read as an error:
            // a connector that has never fired may simply not be wired up yet.
            <span className='text-muted-foreground text-sm'>never</span>
          )}
          <span className='text-muted-foreground/80 text-[11px]'>{CADENCE_NOTE[row.source]}</span>
        </div>

        <div className='grid grid-cols-2 gap-2 border-t pt-2'>
          <Metric label='events · 24h' value={row.count24h} />
          <Metric label='events · 7d' value={row.count7d} />
        </div>

        <div className='flex flex-col gap-1 border-t pt-2'>
          <span className='text-muted-foreground text-xs'>Worker queue · 7d</span>
          <div className='flex flex-wrap gap-x-4 gap-y-1 text-xs'>
            <QueueStat label='completed' n={queue.completed} />
            <QueueStat
              label='retrying'
              n={queue.retry}
              tone={queue.retry > 0 ? 'warn' : undefined}
            />
            <QueueStat
              label='failed'
              n={queue.failed}
              tone={queue.failed > 0 ? 'bad' : undefined}
            />
            <QueueStat label='waiting' n={queue.pending} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className='flex flex-col'>
      <span className='text-lg leading-none font-medium tabular-nums'>{value}</span>
      <span className='text-muted-foreground text-[11px]'>{label}</span>
    </div>
  );
}

function QueueStat({ label, n, tone }: { label: string; n: number; tone?: 'bad' | 'warn' }) {
  return (
    <span
      className={cn(
        'tabular-nums',
        n === 0 && 'text-muted-foreground',
        tone === 'bad' && 'font-medium text-red-600',
        tone === 'warn' && 'font-medium text-amber-700'
      )}
    >
      {n} {label}
    </span>
  );
}
