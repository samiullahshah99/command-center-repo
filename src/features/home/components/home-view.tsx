'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Icons } from '@/components/icons';
import {
  EmptyState,
  InitialsAvatar,
  Panel,
  Row,
  ROW_META,
  ROW_TITLE,
  RowList,
  Screen,
  SectionLabel,
  StatCard,
  StatGrid,
  StatusDot,
  TagPill
} from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format-date';
import { BRIEF_STATES } from '@/lib/brief-states';
import { STATE_LABEL } from '@/features/briefs/constants/brief-states';
import { homeSnapshotQueryOptions } from '../api/queries';
import type { AttentionRow, HomeSnapshot } from '../api/types';

/**
 * The Command Center landing page. One question: what needs your attention?
 *
 * ── Styling provenance ──────────────────────────────────────────────────────
 * Laid out to the Control Tower screen of
 * `docs/design-reference/Command_Center_dc.html`, using the shared primitives in
 * `@/components/ui/panel` so the type scale is stated once rather than
 * re-transcribed per screen.
 *
 * ⚠️ THE MOCK'S LAYOUT, NEVER ITS CONTENT. That screen is populated with
 * invented data — "482 tickets · CSAT 4.6", four departments, a Zendesk feed, a
 * founder copilot. None of it exists here. Where the mock shows a metric we
 * cannot compute, the slot is filled with one we can (its four "Department
 * health" cards became the four real brief states) or dropped entirely. Adding a
 * card to match the mock's shape would be exactly the failure `api/types.ts`
 * forbids: a number that is not true either invents urgency or hides it.
 *
 * ⚠️ RED AND AMBER APPEAR IN EXACTLY TWO PLACES — the attention widget (its stat
 * sub-line and its rows, which are one thing) and the sent-back brief count.
 * Everything else is neutral. Colour that appears everywhere stops meaning
 * anything, and this page's whole job is that a glance tells you whether to act.
 */
export function HomeView() {
  const { data } = useSuspenseQuery(homeSnapshotQueryOptions());

  // ⚠️ ONE `now` for the page, from the SERVER's value. Every relative label and
  // day-count derives from it — a per-render clock differs between SSR and
  // hydration and React discards the subtree.
  const now = useMemo(() => new Date(data.now), [data.now]);

  return (
    <Screen>
      {/*
        The mock puts this pill on the title row's right end. Our page title is
        owned by PageContainer (CLAUDE.md: never import <Heading> manually), and
        its `pageHeaderAction` renders outside this component's
        HydrationBoundary — a pill there would open a second RPC for a string we
        already have. So it sits tucked under the header instead.
      */}
      <div className='-mt-2 flex justify-end'>
        <LivePill data={data} now={now} />
      </div>

      <HomeStats data={data} now={now} />

      <section>
        <SectionLabel>Brief pipeline</SectionLabel>
        <PipelineGrid data={data} />
      </section>

      <div className='grid gap-[14px] lg:grid-cols-[3fr_2fr]'>
        <NeedsAttention data={data} />
        <div className='flex flex-col gap-[14px]'>
          <ActivityPulse data={data} now={now} />
          <TeamCard data={data} />
        </div>
      </div>
    </Screen>
  );
}

/**
 * Mock: "Live · synced 2m ago". Ours is anchored to the newest `unified_event`,
 * which is the only liveness signal we actually hold — an uptime claim we cannot
 * substantiate would be decoration pretending to be telemetry.
 */
function LivePill({ data, now }: { data: HomeSnapshot; now: Date }) {
  const last = data.lastEvent;

  return (
    <span className='text-muted-foreground inline-flex items-center gap-[6px] rounded-full border px-[10px] py-[2px] text-[11.5px] font-semibold'>
      <StatusDot tone={last ? 'success' : 'neutral'} />
      {last ? <>Live · last event {formatRelativeTime(last.at, now)}</> : 'No events yet'}
    </span>
  );
}

function HomeStats({ data, now }: { data: HomeSnapshot; now: Date }) {
  /*
    The worst row after the service's severity sort, used for the sub-line.
    ⚠️ Read from `attention[0]`, not from a count over the shown rows: the array
    is capped at ATTENTION_CAP, so tallying it would understate the total that
    the headline number already reports honestly.
  */
  const worst = data.attention[0];
  const attentionSub =
    data.attentionTotal === 0
      ? 'all clear'
      : worst?.days != null
        ? `worst ${worst.days}d in state`
        : 'needs an owner';

  return (
    <StatGrid>
      <StatCard
        label='Needs attention'
        value={data.attentionTotal}
        sub={attentionSub}
        subClassName={
          data.attentionTotal === 0
            ? 'text-success-muted-foreground'
            : worst?.severity === 'red'
              ? 'text-destructive'
              : 'text-warning-muted-foreground'
        }
      />
      {/* TODO: re-point to /dashboard/review when that route exists (Day 4). */}
      <StatCard
        label='Awaiting review'
        value={data.reviewPending}
        sub={
          data.reviewOldestAt
            ? `oldest ${formatRelativeTime(data.reviewOldestAt, now)}`
            : 'nothing pending'
        }
        href='/dashboard/extraction'
      />
      <StatCard
        label='Events · 7d'
        value={data.activityTotal}
        sub={data.lastEvent ? `last from ${data.lastEvent.source}` : 'no events yet'}
      />
      {/*
        ⚠️ THE PAGE'S OWN ACCURACY WARNING, promoted to a stat card. An unlinked
        identity silently zeroes attribution in every widget here — team
        presence, brief strategists, activity. A number that is quietly wrong is
        worse than a number labelled as incomplete.
      */}
      <StatCard
        label='Unlinked identities'
        value={data.identitiesUnlinked}
        sub={data.identitiesUnlinked > 0 ? 'attribution incomplete' : 'all linked'}
        href='/dashboard/identities'
      />
    </StatGrid>
  );
}

/**
 * The mock's four "Department health" cards. We have no department model, so the
 * slot holds the four real brief lifecycle states instead — same grid, same
 * treatment, data that exists.
 */
function PipelineGrid({ data }: { data: HomeSnapshot }) {
  return (
    <StatGrid>
      {BRIEF_STATES.map((state) => {
        const n = data.pipeline[state];
        // The ONLY amber outside the attention widget: a sent-back brief is
        // stalled work waiting on a specific person.
        const amber = state === 'sent_back' && n > 0;

        return (
          <StatCard
            key={state}
            href='/dashboard/briefs'
            leading={<StatusDot tone={amber ? 'warning' : 'neutral'} />}
            label={STATE_LABEL[state]}
            value={<span className={cn(amber && 'text-warning-muted-foreground')}>{n}</span>}
          />
        );
      })}
    </StatGrid>
  );
}

function NeedsAttention({ data }: { data: HomeSnapshot }) {
  const overflow = data.attentionTotal - data.attention.length;

  return (
    <Panel title='Needs attention' meta={data.attentionTotal > 0 ? 'worst first' : undefined}>
      {data.attention.length === 0 ? (
        <EmptyState
          icon={<Icons.check className='size-5' />}
          title='Nothing needs attention'
          detail='No stalled briefs and no action items missing an owner.'
        />
      ) : (
        <RowList>
          {data.attention.map((row) => (
            <AttentionItem key={row.key} row={row} />
          ))}
        </RowList>
      )}

      {overflow > 0 && (
        <Link
          href='/dashboard/briefs'
          className='text-muted-foreground hover:text-foreground text-[11.5px]'
        >
          +{overflow} more →
        </Link>
      )}
    </Panel>
  );
}

function AttentionItem({ row }: { row: AttentionRow }) {
  const tone =
    row.severity === 'red'
      ? 'text-destructive'
      : row.severity === 'amber'
        ? 'text-warning-muted-foreground'
        : 'text-muted-foreground';

  return (
    <Row href={row.href} className='py-[10px]'>
      <StatusDot
        tone={
          row.severity === 'red' ? 'destructive' : row.severity === 'amber' ? 'warning' : 'neutral'
        }
        className='size-2'
      />

      <span className='flex min-w-0 flex-1 flex-col'>
        <span className={cn(ROW_TITLE, 'truncate')}>{row.title}</span>
        {row.detail && (
          <span className='text-muted-foreground/70 mt-[2px] font-mono text-[10.5px]'>
            {row.detail}
          </span>
        )}
      </span>

      {row.actorName && (
        <span className='hidden items-center gap-[6px] sm:flex'>
          <InitialsAvatar initials={row.actorName.slice(0, 2).toUpperCase()} size={22} />
          <span className={cn(ROW_META, 'max-w-24 truncate')}>{row.actorName}</span>
        </span>
      )}

      {row.days !== null ? (
        <span className={cn('shrink-0 text-[11.5px] font-semibold tabular-nums', tone)}>
          {row.days}d
        </span>
      ) : (
        <TagPill>needs owner</TagPill>
      )}
    </Row>
  );
}

/**
 * Liveness, not analytics. Deliberately neutral so it cannot compete with Needs
 * Attention — the founder should never mistake "the pipes are warm" for
 * "something is wrong".
 */
function ActivityPulse({ data, now }: { data: HomeSnapshot; now: Date }) {
  const peak = Math.max(...data.activity.map((d) => d.count), 1);

  return (
    <Panel
      title='Activity · 7d'
      meta={data.lastEvent ? formatRelativeTime(data.lastEvent.at, now) : '—'}
    >
      {data.activityTotal > 0 ? (
        <div
          className='flex h-[64px] items-end gap-[6px]'
          role='img'
          aria-label={`${data.activityTotal} events in the last 7 days`}
        >
          {data.activity.map((d) => (
            <div key={d.day} className='flex flex-1 flex-col items-center gap-[6px]'>
              <span className='text-[11px] font-semibold tabular-nums'>{d.count || ''}</span>
              <div
                title={`${d.day}: ${d.count} event${d.count === 1 ? '' : 's'}`}
                className={cn(
                  'w-full rounded-t-[4px]',
                  d.count > 0 ? 'bg-muted-foreground/40' : 'bg-muted'
                )}
                style={{
                  height: d.count > 0 ? `${Math.max(10, (d.count / peak) * 100)}%` : '2px'
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <span className='text-muted-foreground text-[12px]'>no events in 7 days</span>
      )}
    </Panel>
  );
}

/** Mock's "Team" card: avatar + name rows, separated by top borders. */
function TeamCard({ data }: { data: HomeSnapshot }) {
  return (
    <Panel
      title='Team'
      meta={
        <Link href='/dashboard/people' className='hover:text-foreground'>
          All →
        </Link>
      }
    >
      {/*
        An empty <ul> under a header reads as a failed fetch rather than as an
        empty roster, which is the same misdiagnosis the locale bug caused.
      */}
      {data.team.length === 0 && (
        <span className='text-muted-foreground text-[12px]'>no people on the roster</span>
      )}

      <RowList>
        {data.team.map((m) => (
          <Row key={m.id}>
            <InitialsAvatar initials={m.initials} />
            <span className={cn(ROW_TITLE, 'min-w-0 flex-1 truncate')}>{m.name}</span>
            {/*
              Presence only — no counts, no ranking. The dot means an attributed
              event landed in 24h; grey means it did not, which is NOT a
              judgement about the person.
            */}
            <span className='flex shrink-0 items-center gap-[6px]'>
              <StatusDot tone={m.active24h ? 'success' : 'neutral'} />
              <span className={ROW_META}>{m.active24h ? 'active' : '—'}</span>
            </span>
            <span className='sr-only'>
              {m.name} — {m.active24h ? 'active in the last 24 hours' : 'no recent activity'}
            </span>
          </Row>
        ))}
      </RowList>
    </Panel>
  );
}
