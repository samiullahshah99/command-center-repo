'use client';

import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import {
  CARD_TITLE,
  LABEL_CAPS,
  Panel,
  Screen,
  StatCard,
  StatusDot,
  TagPill
} from '@/components/ui/panel';
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
    <Screen>
      <HeaderStrip
        eventsToday={data.eventsToday}
        jobsFailed={data.jobsFailed}
        deadLettered={data.deadLettered}
        unprocessedCount={data.unprocessedCount}
        oldestUnprocessedAt={data.oldestUnprocessedAt}
        now={now}
      />

      <div className='grid gap-[14px] md:grid-cols-2 xl:grid-cols-3'>
        {data.sources.map((s) => (
          <SourceCard key={s.source} row={s} now={now} />
        ))}
      </div>

      {/*
        The honesty caption, stated once for the whole page rather than repeated
        per card. It is the most important sentence here: nothing on this page
        measures webhook subscription health, because no provider exposes it.
      */}
      <p className='text-muted-foreground max-w-3xl text-[11.5px] leading-[1.6]'>
        Webhook subscription health is <strong>not queryable</strong> — no provider offers an
        endpoint that answers &ldquo;is my subscription still alive?&rdquo;. &ldquo;Last event
        received&rdquo; is the honest proxy: a silent source and a broken subscription look
        identical from here. Freshness thresholds are per source, because Vision emits tens of
        events a day while ClickUp can legitimately be quiet for a fortnight.
      </p>
    </Screen>
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
    <div className='grid gap-[14px] sm:grid-cols-3'>
      <StatCard label='Events today' value={eventsToday} />
      <StatCard
        label='Jobs failed · 7d'
        value={<span className={cn(jobsFailed > 0 && 'text-destructive')}>{jobsFailed}</span>}
        sub={deadLettered > 0 ? `${deadLettered} dead-lettered` : undefined}
      />
      {/*
        The single most useful number here. A growing age means the worker is
        not draining; zero unprocessed means ingestion and normalisation are
        keeping up, which is why the healthy state says so explicitly rather
        than rendering an empty slot.
      */}
      <StatCard
        label='Oldest unprocessed'
        value={
          <span className={cn(oldestUnprocessedAt && 'text-warning-muted-foreground')}>
            {oldestUnprocessedAt ? formatRelativeTime(oldestUnprocessedAt, now) : 'none'}
          </span>
        }
        sub={
          oldestUnprocessedAt
            ? `${unprocessedCount} awaiting normalisation`
            : 'all events normalised'
        }
      />
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
    <Panel>
      <div className='flex flex-wrap items-center gap-[8px]'>
        <StatusDot
          tone={
            indicator === 'bad'
              ? 'destructive'
              : indicator === 'warn'
                ? 'warning'
                : indicator === 'ok'
                  ? 'success'
                  : 'neutral'
          }
          className='size-2'
        />
        <span className={CARD_TITLE}>{SOURCE_LABEL[row.source]}</span>
        {queue.failed > 0 && <TagPill tone='destructive'>{queue.failed} failed</TagPill>}
        {queue.retry > 0 && <TagPill tone='warning'>{queue.retry} retrying</TagPill>}
      </div>

      {/* Last event received — the proxy, labelled as such. */}
      <div className='flex flex-col gap-[2px]'>
        <span className={LABEL_CAPS}>Last event received</span>
        {row.lastEventAt ? (
          <span className={cn('text-[13px]', isQuiet && 'text-warning-muted-foreground')}>
            {formatRelativeTime(row.lastEventAt, now)}
            {isQuiet && (
              <span className='text-muted-foreground'> · quiet beyond {row.staleAfterHours}h</span>
            )}
          </span>
        ) : (
          // "Never" is a distinct fact from "quiet" and must not read as an error:
          // a connector that has never fired may simply not be wired up yet.
          <span className='text-muted-foreground text-[13px]'>never</span>
        )}
        <span className='text-muted-foreground/80 text-[11px]'>{CADENCE_NOTE[row.source]}</span>
      </div>

      <div className='grid grid-cols-2 gap-[8px] border-t pt-[10px]'>
        <Metric label='events · 24h' value={row.count24h} />
        <Metric label='events · 7d' value={row.count7d} />
      </div>

      <div className='flex flex-col gap-[4px] border-t pt-[10px]'>
        <span className={LABEL_CAPS}>Worker queue · 7d</span>
        <div className='flex flex-wrap gap-x-[14px] gap-y-[2px] text-[11.5px]'>
          <QueueStat label='completed' n={queue.completed} />
          <QueueStat label='retrying' n={queue.retry} tone={queue.retry > 0 ? 'warn' : undefined} />
          <QueueStat label='failed' n={queue.failed} tone={queue.failed > 0 ? 'bad' : undefined} />
          <QueueStat label='waiting' n={queue.pending} />
        </div>
      </div>
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className='flex flex-col'>
      <span className='text-[17px] leading-none font-bold tabular-nums'>{value}</span>
      <span className='text-muted-foreground mt-[3px] text-[11px]'>{label}</span>
    </div>
  );
}

function QueueStat({ label, n, tone }: { label: string; n: number; tone?: 'bad' | 'warn' }) {
  return (
    <span
      className={cn(
        'tabular-nums',
        n === 0 && 'text-muted-foreground',
        tone === 'bad' && 'text-destructive font-medium',
        tone === 'warn' && 'text-warning-muted-foreground font-medium'
      )}
    >
      {n} {label}
    </span>
  );
}
