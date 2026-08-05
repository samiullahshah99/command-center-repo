'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  EmptyState,
  InitialsAvatar,
  LABEL_CAPS,
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
import { formatDateOnly, formatRelativeTime } from '@/lib/format-date';
import { BRIEF_STATES } from '@/lib/brief-states';
import { STATE_LABEL } from '@/features/briefs/constants/brief-states';
import { homeSnapshotQueryOptions } from '../api/queries';
import type { AttentionRow, DeptCard, HomeSnapshot, ProjectRow } from '../api/types';

/**
 * Executive Control Tower.
 *
 * ── Styling provenance ──────────────────────────────────────────────────────
 * Laid out to the mockup's Control Tower screen, using the shared primitives in
 * `@/components/ui/panel` so the type scale is stated once rather than
 * re-transcribed per screen.
 *
 * ⚠️ THE MOCKUP'S LAYOUT, NEVER ITS CONTENT. That screen is populated with
 * invented data — "482 tickets · CSAT 4.6", a Zendesk feed, a working copilot.
 * Every number here comes from a real query with ONE labelled exception (the
 * copilot exchange and the auto-completed row; see their notes and docs/gaps.md).
 * Adding a card to match the mockup's shape would be exactly what
 * `../api/types.ts` forbids: a number that is not true either invents urgency or
 * hides it.
 *
 * ⚠️ COLOUR IS RATIONED. Red and amber appear in the attention widget, the
 * department health badges, and the sent-back brief count. Everything else is
 * neutral. Colour that appears everywhere stops meaning anything, and this page's
 * whole job is that a glance tells you whether to act.
 *
 * ⚠️ ONE ROLLUP. Everything below reads from a single `getHomeSnapshot()` call —
 * the audit's compliant pre-aggregated endpoint. Do not add a second rollup for a
 * new widget; extend that one.
 */
export function HomeView() {
  const { data } = useSuspenseQuery(homeSnapshotQueryOptions());

  // ⚠️ ONE `now` for the page, from the SERVER's value. Every relative label and
  // day-count derives from it — a per-render clock differs between SSR and
  // hydration and React discards the subtree. Never Date.now() in a renderer.
  const now = useMemo(() => new Date(data.now), [data.now]);

  return (
    <Screen>
      <TowerHeader data={data} now={now} />

      <CompanyStats data={data} />

      <section>
        <SectionLabel>Department health</SectionLabel>
        <DepartmentGrid data={data} />
      </section>

      <div className='grid gap-[14px] lg:grid-cols-[3fr_2fr]'>
        <ActiveProjects data={data} />
        <NeedsAttention data={data} />
      </div>

      <div className='grid gap-[14px] lg:grid-cols-[3fr_2fr]'>
        <FounderCopilot />
        <WeeklyCaptureCard data={data} />
      </div>

      {/*
        ⚠️ BELOW THE MOCKUP'S LAYOUT, AND KEPT DELIBERATELY. These three widgets
        are not on the mockup's Control Tower, and all three are real data that was
        built on purpose: the brief pipeline (the only view of Vision brief state
        on this page), the 7-day activity pulse (the only liveness signal we
        actually hold), and team presence. Dropping them to match the mockup would
        be a data regression, not a tidier screen. Delete this block to match the
        mockup exactly.
      */}
      <section>
        <SectionLabel>Brief pipeline</SectionLabel>
        <PipelineGrid data={data} />
      </section>

      <div className='grid gap-[14px] lg:grid-cols-[3fr_2fr]'>
        <ActivityPulse data={data} now={now} />
        <TeamCard data={data} />
      </div>
    </Screen>
  );
}

/** Title row: name, today's date, and the liveness pill pushed right. */
function TowerHeader({ data, now }: { data: HomeSnapshot; now: Date }) {
  return (
    <div className='flex flex-wrap items-baseline gap-x-[10px] gap-y-[4px]'>
      <h1 className='text-[21px] leading-none font-bold tracking-[-0.01em]'>
        Executive Control Tower
      </h1>
      {/*
        ⚠️ Formatted from the SERVER's `now` through the pinned-locale helper, not
        from a fresh clock. `formatDateOnly` fixes both locale and timezone; a bare
        toLocaleDateString() resolves to the host's locale and produced the
        hydration mismatch documented in CLAUDE.md.
      */}
      <span className='text-muted-foreground text-[12.5px]'>
        Company state · {formatDateOnly(now.toISOString())}
      </span>
      <div className='flex-1' />
      <LivePill data={data} now={now} />
    </div>
  );
}

/**
 * "Live · synced 2m ago" in the mockup. Ours is anchored to the newest
 * `unified_event`, which is the only liveness signal we actually hold — an uptime
 * claim we cannot substantiate would be decoration pretending to be telemetry.
 *
 * ⚠️ The dot uses the SUCCESS TOKEN via `StatusDot`, never `bg-emerald-500`. A
 * palette literal renders a light dot on a dark surface — the exact bug the
 * semantic-token adoption removed everywhere else.
 */
function LivePill({ data, now }: { data: HomeSnapshot; now: Date }) {
  const last = data.lastEvent;

  return (
    <span className='text-muted-foreground inline-flex shrink-0 items-center gap-[6px] rounded-full border px-[10px] py-[2px] text-[11.5px] font-semibold'>
      <StatusDot tone={last ? 'success' : 'neutral'} className='size-[7px]' />
      {last ? <>Live · synced {formatRelativeTime(last.at, now)}</> : 'No events yet'}
    </span>
  );
}

/** The mockup's weekly capture counters. All four are real counts. */
function CompanyStats({ data }: { data: HomeSnapshot }) {
  const { weekly } = data;

  return (
    <StatGrid>
      <StatCard label='Action items captured' value={weekly.captured} sub='this week' />
      <StatCard
        label='From meetings (Fireflies)'
        value={weekly.fromMeetings}
        sub='transcript extraction'
      />
      <StatCard label='From Slack' value={weekly.fromSlack} sub='thread extraction' />
      <StatCard
        label='Open review queue'
        value={data.reviewPending}
        sub={weekly.captured > 0 ? 'awaiting a decision' : 'nothing pending'}
        href='/dashboard/extraction'
      />
    </StatGrid>
  );
}

const HEALTH_LABEL: Record<DeptCard['health'], string> = {
  good: 'On track',
  needs_attention: 'Needs attention',
  bad: 'At risk'
};

/**
 * Health badge tone.
 *
 * ⚠️ `border-current` so the border tracks the text colour — a tone change is one
 * class, not two that can disagree. Same treatment as `TagPill`.
 */
const HEALTH_BADGE: Record<DeptCard['health'], string> = {
  good: 'text-success-muted-foreground border-current',
  needs_attention: 'text-warning-muted-foreground border-current',
  bad: 'text-destructive border-current'
};

/**
 * Department health cards.
 *
 * ⚠️ THE SAME DATA AS THE SIDEBAR'S DOTS. Both come from `getDeptNav()`, which
 * shares one query and one `computeDeptHealth()` call — a card and a dot cannot
 * report different states for the same department.
 *
 * ⚠️ Renders nothing when the list is empty rather than an empty grid under a
 * label: before migration 0011 is applied there are no departments, and a bare
 * "DEPARTMENT HEALTH" heading with nothing under it reads as a failed load.
 */
function DepartmentGrid({ data }: { data: HomeSnapshot }) {
  if (data.departments.length === 0) {
    return (
      <span className='text-muted-foreground text-[12px]'>
        No departments yet — apply migration 0011 and seed to populate.
      </span>
    );
  }

  return (
    <div className='grid gap-[14px] sm:grid-cols-2 lg:grid-cols-4'>
      {data.departments.map((d) => (
        <Link key={d.id} href={`/dashboard/departments/${d.id}`} className='group'>
          <Card className='group-hover:border-ring h-full gap-[8px] p-[16px] transition-colors'>
            <div className='flex items-center gap-[8px]'>
              {/* 8px accent dot. Inline style because the value is a theme token
                  reference resolved per department — see @/lib/dept-accent. */}
              <span
                aria-hidden
                className='size-[8px] shrink-0 rounded-full'
                style={{ backgroundColor: d.accentVar }}
              />
              <span className='min-w-0 flex-1 truncate text-[14px] font-semibold'>{d.name}</span>
            </div>

            <span
              className={cn(
                'w-fit self-start rounded-full border px-[7px] py-px text-[11px] font-semibold',
                HEALTH_BADGE[d.health]
              )}
            >
              {HEALTH_LABEL[d.health]}
            </span>

            {/*
              ⚠️ The note is `computeDeptHealth`'s own reasons[], not prose written
              here. The function already explains itself ("2 blocked items",
              "1 item overdue, worst by 5 days"); restating it in the component
              would be a second wording to keep in sync.
            */}
            <p className='text-muted-foreground text-[12.5px] leading-[1.45]'>
              {d.healthReasons.length > 0
                ? d.healthReasons.join(' · ')
                : 'No overdue or blocked work'}
            </p>

            <p className='text-[12px] font-semibold'>
              {d.openCount} open · {d.peopleCount} {d.peopleCount === 1 ? 'person' : 'people'}
            </p>
          </Card>
        </Link>
      ))}
    </div>
  );
}

const PROJECT_STATUS: Record<ProjectRow['status'], { label: string; tone: string }> = {
  active: { label: 'In flight', tone: 'text-muted-foreground' },
  paused: { label: 'Paused', tone: 'text-warning-muted-foreground' },
  complete: { label: 'Done', tone: 'text-success-muted-foreground' }
};

function ActiveProjects({ data }: { data: HomeSnapshot }) {
  return (
    <Panel title='Active projects' meta={`${data.projects.length}`}>
      {data.projects.length === 0 ? (
        <EmptyState
          icon={<Icons.workspace className='size-5' />}
          title='No active projects'
          detail='Projects appear here once one exists and is not archived.'
        />
      ) : (
        <RowList>
          {data.projects.map((p) => {
            const meta = PROJECT_STATUS[p.status];

            return (
              <Row key={p.id} href={`/dashboard/tracker/${p.id}`} className='py-[10px]'>
                <StatusDot tone='neutral' className='size-2' />

                <span className='flex min-w-0 flex-1 flex-col'>
                  <span className={cn(ROW_TITLE, 'truncate')}>{p.name}</span>
                  <span className={cn(ROW_META, 'truncate')}>
                    {p.ownerName ?? 'No lead'} · {p.openCount} open of {p.totalCount}
                  </span>
                </span>

                <span className='hidden w-[110px] shrink-0 flex-col gap-[4px] sm:flex'>
                  {p.progressPct === null ? (
                    <span className={cn(ROW_META, 'italic')}>no items</span>
                  ) : (
                    <>
                      <Progress value={p.progressPct} className='h-[6px]' />
                      <span className={cn(ROW_META, 'tabular-nums')}>{p.progressPct}%</span>
                    </>
                  )}
                </span>

                {/*
                  ⚠️ `project` HAS NO DUE-DATE COLUMN (audit §1.4), so this is an
                  em dash rather than an invented date.
                  TODO(backend): project.due — needs a schema column, which is a
                  deliberate migration, NOT something to add here.
                */}
                <span className={cn(ROW_META, 'hidden w-[70px] shrink-0 text-right md:block')}>
                  —
                </span>

                <span
                  className={cn(
                    'w-[64px] shrink-0 text-right text-[11.5px] font-semibold',
                    meta.tone
                  )}
                >
                  {meta.label}
                </span>
              </Row>
            );
          })}
        </RowList>
      )}
    </Panel>
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

/** Human labels for the attention row's `kind`, shown as the right-hand pill. */
const KIND_LABEL: Record<AttentionRow['kind'], string> = {
  brief_sent_back: 'sent back',
  brief_in_review: 'in review',
  candidate_unowned: 'needs owner'
};

function AttentionItem({ row }: { row: AttentionRow }) {
  const tone =
    row.severity === 'red'
      ? 'text-destructive'
      : row.severity === 'amber'
        ? 'text-warning-muted-foreground'
        : 'text-muted-foreground';

  const meta = [row.detail, row.days !== null ? `${row.days}d in state` : null, row.actorName]
    .filter(Boolean)
    .join(' · ');

  return (
    <Row href={row.href} className='py-[10px]'>
      <StatusDot
        tone={
          row.severity === 'red' ? 'destructive' : row.severity === 'amber' ? 'warning' : 'neutral'
        }
        className='size-2'
      />

      <span className='flex min-w-0 flex-1 flex-col'>
        <span className={cn('truncate text-[13px] font-semibold')}>{row.title}</span>
        {meta && <span className={cn(ROW_META, 'mt-[2px] truncate')}>{meta}</span>}
      </span>

      {row.days !== null && (
        <span className={cn('shrink-0 text-[11.5px] font-semibold tabular-nums', tone)}>
          {row.days}d
        </span>
      )}

      <TagPill>{KIND_LABEL[row.kind]}</TagPill>
    </Row>
  );
}

/**
 * Founder copilot.
 *
 * ⚠️⚠️ EVERY WORD OF THIS EXCHANGE IS HARDCODED DEMO COPY. There is no copilot
 * backend: no retrieval layer, no index, no `POST /copilot/ask`. The audit scopes
 * it at §2.3 (the panel) and §2.9 (the retrieval it depends on), and role-filtered
 * retrieval is a hard requirement that has to be designed before anything is
 * indexed. Logged in docs/gaps.md.
 *
 * ⚠️ It carries a "Preview" caption and NO INPUT FIELD. A text box here would
 * invite a real question and answer it with a canned reply about a company that
 * does not exist — the single most misleading thing this page could do. The
 * working affordance is the top bar's copilot field, which navigates to AI search.
 *
 * ⚠️ SOURCES SAY "Portal", NOT "Shopify". The mockup cites Shopify; per the audit
 * §3.7 there is no Shopify client and none is to be built — internal backend
 * endpoints replace it.
 */
function FounderCopilot() {
  return (
    <Panel
      title='Founder copilot'
      meta={<span className='text-[11px]'>@command-center in Slack</span>}
    >
      <p className={cn(LABEL_CAPS, 'text-warning-muted-foreground')}>Preview</p>

      <div className='flex flex-col gap-[10px]'>
        {/* The question, as a founder would ask it in Slack. */}
        <div className='flex items-start gap-[8px]'>
          <span
            aria-hidden
            className='bg-muted text-muted-foreground flex size-[28px] shrink-0 items-center justify-center rounded-[8px] text-[11px] font-bold'
          >
            D
          </span>
          <p className='bg-muted rounded-[10px] px-[12px] py-[8px] text-[13px] leading-[1.5]'>
            What&rsquo;s going on with Commercive on the sample request?
          </p>
        </div>

        {/* The reply. Demo copy — see the header. */}
        <div className='flex items-start gap-[8px]'>
          <span
            aria-hidden
            className='bg-primary text-primary-foreground flex size-[28px] shrink-0 items-center justify-center rounded-[8px] text-[10px] font-bold'
          >
            CC
          </span>
          <div className='flex-1 rounded-[10px] border px-[12px] py-[8px]'>
            <p className='text-[13px] leading-[1.55]'>
              Samples were requested three days ago and the supplier has not confirmed a ship date.
              The action item is open and owned, with no update since the request went out. Nothing
              is blocked on us — the next move is a chase, not a decision.
            </p>
            <p className='text-muted-foreground mt-[8px] text-[11px]'>
              Sources: #proj-sourcing · ClickUp · Portal
            </p>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Label/value rows for the week. Three real counts plus one marked placeholder. */
function WeeklyCaptureCard({ data }: { data: HomeSnapshot }) {
  const { weekly } = data;

  const rows: { label: string; value: number; sample?: boolean }[] = [
    { label: 'Action items captured', value: weekly.captured },
    { label: 'From meetings (Fireflies)', value: weekly.fromMeetings },
    { label: 'From Slack', value: weekly.fromSlack },
    {
      label: 'Auto-completed from activity',
      value: weekly.autoCompleted,
      sample: weekly.autoCompletedIsSample
    },
    { label: 'Open review queue', value: data.reviewPending }
  ];

  return (
    <Panel title="This week's capture" meta={`since ${formatDateOnly(weekly.weekStart)}`}>
      <RowList>
        {rows.map((r) => (
          <Row key={r.label}>
            <span className='text-muted-foreground min-w-0 flex-1 truncate text-[13px]'>
              {r.label}
              {/*
                ⚠️ The caption is rendered from the DATA's own flag, never from a
                literal here. When the completion engine lands, the service flips
                one field and this disappears — there is no second place to
                remember.
              */}
              {r.sample && (
                <span className='text-warning-muted-foreground ml-[6px] text-[10.5px] font-semibold'>
                  preview
                </span>
              )}
            </span>
            <span className='shrink-0 text-[13px] font-semibold tabular-nums'>{r.value}</span>
          </Row>
        ))}
      </RowList>

      {/*
        ⚠️ NAVIGATION → a <Link> styled with buttonVariants, never a <Button>
        wrapping a link. `ButtonPrimitive` declares `nativeButton = true`, so
        composing an <a> into it violates its contract and Base UI warns. Same fix
        as header-bar.tsx and profile-header.tsx.
      */}
      <Link
        href='/dashboard/extraction'
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-fit')}
      >
        Open review queue
      </Link>
    </Panel>
  );
}

/** The four real Vision brief lifecycle states. */
function PipelineGrid({ data }: { data: HomeSnapshot }) {
  return (
    <StatGrid>
      {BRIEF_STATES.map((state) => {
        const n = data.pipeline[state];
        // The ONLY amber outside attention and department health: a sent-back
        // brief is stalled work waiting on a specific person.
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

/** Team presence: avatar + name rows, separated by top borders. */
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
              event landed in 24h; grey means it did not, which is NOT a judgement
              about the person.
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
