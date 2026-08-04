'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format-date';
import { BRIEF_STATES } from '@/lib/brief-states';
import { STATE_LABEL } from '@/features/briefs/constants/brief-states';
import { homeSnapshotQueryOptions } from '../api/queries';
import type { AttentionRow, HomeSnapshot } from '../api/types';

/**
 * The Command Center landing page. One question: what needs my attention?
 *
 * ⚠️ Red and amber appear in EXACTLY TWO places on this page — the Needs
 * Attention rows and the sent-back pipeline count. Everything else is neutral.
 * Colour that appears everywhere stops meaning anything, and this page's whole
 * job is that a glance tells you whether to act.
 *
 * ⚠️ Every number is real. There are no sample values and no placeholders, so a
 * zero renders as a zero rather than as an empty state — see the Review card.
 */
export function HomeView() {
  const { data } = useSuspenseQuery(homeSnapshotQueryOptions());

  // ⚠️ ONE `now` for the page, from the SERVER's value. Every relative label and
  // day-count derives from it — a per-render clock differs between SSR and
  // hydration and React discards the subtree.
  const now = useMemo(() => new Date(data.now), [data.now]);

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid gap-4 lg:grid-cols-5'>
        <NeedsAttention data={data} />

        <div className='flex flex-col gap-4 lg:col-span-2'>
          <ReviewCard data={data} now={now} />
          <ActivityPulse data={data} now={now} />
        </div>
      </div>

      <PipelineStrip data={data} />
      <TeamStrip data={data} />
    </div>
  );
}

function NeedsAttention({ data }: { data: HomeSnapshot }) {
  const overflow = data.attentionTotal - data.attention.length;

  return (
    <Card className='lg:col-span-3'>
      <CardContent className='flex flex-col gap-3 py-4'>
        <h2 className='text-sm font-medium'>Needs attention</h2>

        {data.attention.length === 0 ? (
          /*
            ⚠️ THE ZERO STATE IS THE PRODUCT WORKING, and it is styled as a
            result rather than an absence. On a seven-person team this is the
            COMMON state; an apologetic grey "no data" box would make the normal
            case look like a broken page.
          */
          <div className='flex flex-col items-center gap-2 py-10 text-center'>
            <span className='flex size-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200'>
              <Icons.check className='size-5' />
            </span>
            <span className='text-base font-medium'>Nothing needs attention</span>
            <span className='text-muted-foreground max-w-xs text-xs'>
              No stalled briefs and no action items missing an owner.
            </span>
          </div>
        ) : (
          <ul className='flex flex-col divide-y'>
            {data.attention.map((row) => (
              <AttentionItem key={row.key} row={row} />
            ))}
          </ul>
        )}

        {overflow > 0 && (
          <Link
            href='/dashboard/briefs'
            className='text-muted-foreground hover:text-foreground text-xs'
          >
            +{overflow} more
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

function AttentionItem({ row }: { row: AttentionRow }) {
  const tone =
    row.severity === 'red'
      ? 'text-red-600'
      : row.severity === 'amber'
        ? 'text-amber-700'
        : 'text-muted-foreground';

  return (
    <li>
      <Link href={row.href} className='hover:bg-muted/40 -mx-2 flex items-center gap-3 px-2 py-2'>
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            row.severity === 'red' && 'bg-red-500',
            row.severity === 'amber' && 'bg-amber-500',
            row.severity === 'unowned' && 'bg-slate-300'
          )}
        />
        <span className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate text-sm'>{row.title}</span>
          {row.detail && (
            <span className='text-muted-foreground/70 font-mono text-[10px]'>{row.detail}</span>
          )}
        </span>

        {row.actorName && (
          <span className='hidden items-center gap-1.5 sm:flex'>
            <span
              aria-hidden
              className='flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-medium text-slate-600'
            >
              {row.actorName.slice(0, 2).toUpperCase()}
            </span>
            <span className='text-muted-foreground max-w-24 truncate text-xs'>{row.actorName}</span>
          </span>
        )}

        {row.days !== null ? (
          <span className={cn('shrink-0 text-xs tabular-nums', tone)}>{row.days}d</span>
        ) : (
          <Badge variant='outline' className='shrink-0 text-[10px] font-normal'>
            needs owner
          </Badge>
        )}
      </Link>
    </li>
  );
}

function ReviewCard({ data, now }: { data: HomeSnapshot; now: Date }) {
  return (
    <Card>
      <CardContent className='py-4'>
        {/* TODO: re-point to /dashboard/review when that route exists (Day 4).
            The count already comes from the shared cached nav count, so the badge
            in the sidebar and this number cannot disagree. */}
        <Link href='/dashboard/extraction' className='flex flex-col gap-1'>
          <span className='text-muted-foreground text-xs'>Awaiting review</span>
          {/* Zero is DATA, not an empty state — it renders as 0. */}
          <span className='text-2xl leading-none font-medium tabular-nums'>
            {data.reviewPending}
          </span>
          <span className='text-muted-foreground text-[11px]'>
            {data.reviewOldestAt
              ? `oldest ${formatRelativeTime(data.reviewOldestAt, now)}`
              : 'nothing pending'}
          </span>
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Liveness, not analytics. Deliberately small and neutral so it cannot compete
 * with Needs Attention — the founder should never mistake "the pipes are warm"
 * for "something is wrong".
 */
function ActivityPulse({ data, now }: { data: HomeSnapshot; now: Date }) {
  const peak = Math.max(...data.activity.map((d) => d.count), 1);

  return (
    <Card>
      <CardContent className='flex flex-col gap-2 py-4'>
        <span className='text-muted-foreground text-xs'>Activity · 7d</span>

        {data.activityTotal > 0 ? (
          <div
            className='flex h-8 items-end gap-1'
            role='img'
            aria-label={`${data.activityTotal} events in the last 7 days`}
          >
            {data.activity.map((d) => (
              <div
                key={d.day}
                title={`${d.day}: ${d.count} event${d.count === 1 ? '' : 's'}`}
                className={cn('flex-1 rounded-sm', d.count > 0 ? 'bg-slate-300' : 'bg-slate-100')}
                style={{
                  height: d.count > 0 ? `${Math.max(12, (d.count / peak) * 100)}%` : '2px'
                }}
              />
            ))}
          </div>
        ) : (
          <span className='text-muted-foreground text-xs'>no events in 7 days</span>
        )}

        <span className='text-muted-foreground text-[11px]'>
          {data.lastEvent ? (
            <>
              last: <span className='capitalize'>{data.lastEvent.source}</span> ·{' '}
              {formatRelativeTime(data.lastEvent.at, now)}
            </>
          ) : (
            'no events yet'
          )}
        </span>
      </CardContent>
    </Card>
  );
}

function PipelineStrip({ data }: { data: HomeSnapshot }) {
  return (
    <Card>
      <CardContent className='py-3'>
        <Link href='/dashboard/briefs' className='flex flex-wrap items-center gap-x-6 gap-y-2'>
          <span className='text-muted-foreground text-xs'>Briefs</span>
          {BRIEF_STATES.map((state) => {
            const n = data.pipeline[state];
            // The ONLY amber outside Needs Attention: a sent-back brief is
            // stalled work waiting on a person.
            const amber = state === 'sent_back' && n > 0;
            return (
              <span key={state} className='flex items-baseline gap-1.5 text-sm'>
                <span className={cn('font-medium tabular-nums', amber && 'text-amber-700')}>
                  {n}
                </span>
                <span className={cn('text-xs', amber ? 'text-amber-700' : 'text-muted-foreground')}>
                  {STATE_LABEL[state]}
                </span>
              </span>
            );
          })}
        </Link>
      </CardContent>
    </Card>
  );
}

function TeamStrip({ data }: { data: HomeSnapshot }) {
  return (
    <Card>
      <CardContent className='flex flex-col gap-2 py-3'>
        <Link href='/dashboard/people' className='flex items-center gap-3'>
          <span className='text-muted-foreground text-xs'>Team</span>
          <span className='flex items-center gap-2'>
            {data.team.map((m) => (
              <span key={m.id} className='relative' title={m.name}>
                <span
                  aria-hidden
                  className='flex size-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-medium text-slate-600'
                >
                  {m.initials}
                </span>
                {/*
                  Presence only — no counts, no ranking. Green means an
                  attributed event landed in 24h; grey means it did not, which is
                  NOT a judgement about the person.
                */}
                <span
                  aria-hidden
                  className={cn(
                    'ring-background absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2',
                    m.active24h ? 'bg-emerald-500' : 'bg-slate-300'
                  )}
                />
                <span className='sr-only'>
                  {m.name} — {m.active24h ? 'active in the last 24 hours' : 'no recent activity'}
                </span>
              </span>
            ))}
          </span>
        </Link>

        {/*
          ⚠️ THE PAGE'S OWN ACCURACY WARNING. An unlinked identity silently zeroes
          attribution in every widget above — team dots, brief strategists,
          activity. Rendered only when nonzero, muted, but present: a number that
          is quietly wrong is worse than a number labelled as incomplete.
        */}
        {data.identitiesUnlinked > 0 && (
          <Link
            href='/dashboard/identities'
            className='text-muted-foreground hover:text-foreground text-[11px]'
          >
            {data.identitiesUnlinked} identities unlinked → fix
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
