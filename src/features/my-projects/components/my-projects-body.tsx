'use client';

import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Icons } from '@/components/icons';
import { TrackedItemRows } from '@/components/tracked-item-rows';
import { Progress } from '@/components/ui/progress';
import { EmptyState, Panel, Row, ROW_META, RowList, Screen, StatCard } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { myProjectsQueryOptions } from '../api/queries';
import type { MyProjects, ProjectStatus } from '../api/types';

/**
 * My projects — the coder persona's home screen.
 *
 * ⚠️ NOTHING HERE IS MOCKED. Every number is a real query. The Slack-nudge line at
 * the foot of the risk panel is a STATUS NOTE about a missing integration, not
 * invented activity — see the note on `SlackNudgeNote`.
 *
 * ⚠️ THE SUBTITLE NAMES GITHUB DELIBERATELY and nothing renders a delivery signal.
 * The mockup mentions GitHub only in that subtitle; inventing a commit column or a
 * mocked delivery panel to match a phrase would be exactly the failure the
 * real-data rule prevents. The integration is confirmed in scope and unbuilt —
 * docs/gaps.md already tracks it, so no `isSample` surface is needed here.
 */
export function MyProjectsBody({ personId, nowIso }: { personId: string; nowIso: string }) {
  const { data } = useSuspenseQuery(myProjectsQueryOptions(personId, nowIso));

  // ⚠️ ONE `now` for the subtree, from the SERVER's value. A per-render clock
  // differs between SSR and hydration and React discards the subtree.
  const now = useMemo(() => new Date(data.now), [data.now]);

  return (
    <Screen width='narrow'>
      <div>
        <h1 className='text-[21px] leading-none font-bold tracking-[-0.01em]'>My projects</h1>
        {/* ⚠️ AMENDMENT RELABEL — the mockup says "synced with ClickUp". */}
        <p className='text-muted-foreground mt-[6px] max-w-[720px] text-[13px] leading-[1.5]'>
          Assignments, timelines and progress on the Command Center tracker · delivery signal from
          GitHub.
        </p>
      </div>

      <div className='grid gap-[14px] sm:grid-cols-2 lg:grid-cols-4'>
        <StatCard size='md' label='Projects' value={data.stats.projects} sub="you're active in" />
        <StatCard
          size='md'
          label='Open items'
          value={data.stats.open}
          sub={`${data.stats.overdue} overdue`}
          subClassName={cn(data.stats.overdue > 0 && 'text-destructive font-semibold')}
        />
        <StatCard
          size='md'
          label='In flight'
          value={data.stats.inFlight}
          sub={data.stats.inFlight > 0 ? 'in progress' : 'nothing started'}
        />
        <StatCard
          size='md'
          label='Blocked / at risk'
          value={data.stats.troubled}
          sub={data.stats.troubled > 0 ? 'needs attention' : 'all clear'}
          subClassName={cn(data.stats.troubled > 0 && 'text-destructive font-semibold')}
        />
      </div>

      <ProjectsCard data={data} />

      <div className='grid items-start gap-[14px] lg:grid-cols-[3fr_2fr]'>
        <Panel title={`In flight · ${data.items.length}`} bodyClassName='divide-y'>
          <TrackedItemRows
            items={data.items}
            now={now}
            emptyTitle='Nothing in flight'
            emptyDetail='Items appear here once one is owned by you and still open.'
          />
        </Panel>

        <RiskPanel data={data} />
      </div>
    </Screen>
  );
}

const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; tone: string }> = {
  active: { label: 'In flight', tone: 'text-muted-foreground' },
  paused: { label: 'Paused', tone: 'text-warning-muted-foreground' },
  complete: { label: 'Done', tone: 'text-success-muted-foreground' },
  archived: { label: 'Archived', tone: 'text-muted-foreground' }
};

function ProjectsCard({ data }: { data: MyProjects }) {
  return (
    <Panel title={`Projects · ${data.projects.length}`}>
      {data.projects.length === 0 ? (
        <EmptyState
          icon={<Icons.workspace className='size-5' />}
          title='No projects yet'
          detail='A project appears here once you own an open item in it, or lead it.'
        />
      ) : (
        <RowList>
          {data.projects.map((p) => {
            const meta = PROJECT_STATUS_META[p.status];
            return (
              <Row key={p.id} href={`/dashboard/tracker/${p.id}`} className='py-[10px]'>
                <span className='flex min-w-0 flex-1 flex-col'>
                  <span className='truncate text-[13px] font-semibold'>{p.name}</span>
                  <span className={cn(ROW_META, 'truncate')}>
                    {p.leadName ? `Lead: ${p.leadName}` : 'No lead'}
                    {p.totalCount > 0 ? ` · ${p.openCount} of ${p.totalCount} mine open` : ''}
                  </span>
                </span>

                <span className='hidden w-[110px] shrink-0 flex-col gap-[4px] sm:flex'>
                  {p.progressPct === null ? (
                    // ⚠️ No bar rather than a 0% one — I hold no items here (I lead
                    // it). An empty denominator is not "0% complete".
                    <span className={cn(ROW_META, 'italic')}>no items of mine</span>
                  ) : (
                    <>
                      <Progress value={p.progressPct} className='h-[6px]' />
                      <span className={cn(ROW_META, 'tabular-nums')}>{p.progressPct}%</span>
                    </>
                  )}
                </span>

                {/*
                  ⚠️ `project` HAS NO DUE-DATE COLUMN (audit §1.4), so this is an em
                  dash rather than an invented date.
                  TODO(backend): project.due — a deliberate migration, not something
                  to add here.
                */}
                <span className={cn(ROW_META, 'hidden w-[54px] shrink-0 text-right md:block')}>
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

function RiskPanel({ data }: { data: MyProjects }) {
  return (
    <Panel title='Blocked / at risk' meta={data.risks.length > 0 ? 'worst first' : undefined}>
      {data.risks.length === 0 ? (
        <EmptyState
          icon={<Icons.check className='size-5' />}
          title='Nothing blocked'
          detail='No overdue, blocked or flagged work of yours.'
        />
      ) : (
        <RowList>
          {data.risks.map((r) => (
            <Row key={r.id} href={r.href} className='py-[10px]'>
              <span
                aria-hidden
                className={cn(
                  'size-[8px] shrink-0 rounded-full',
                  r.severity === 'destructive' ? 'bg-destructive' : 'bg-warning'
                )}
              />
              <span className='flex min-w-0 flex-1 flex-col'>
                <span className='truncate text-[13px] font-semibold'>{r.text}</span>
                <span className={cn(ROW_META, 'truncate')}>{r.meta}</span>
              </span>
            </Row>
          ))}
        </RowList>
      )}

      <SlackNudgeNote />
    </Panel>
  );
}

/**
 * The mockup's footer line, rewritten as a STATUS NOTE.
 *
 * ⚠️ THE MOCKUP STATES AN AUTOMATION THAT DOES NOT EXIST: "Overdue items are
 * auto-flagged to Slack — 'deadline approaching, write an update.'" Slack is
 * INGEST-ONLY (audit §2.13 / §5): there is no posting path, no `chat.postMessage`
 * call anywhere, and no alert-rule engine to decide when to fire one.
 *
 * ⚠️ Rendering the mockup's sentence verbatim would be the worst option on this
 * page — a reader would stop chasing an overdue item believing Slack had already
 * nudged its owner. So the claim is inverted into a status: the feature is named,
 * and its absence is the message.
 *
 * TODO(backend): slack post + alert rule.
 */
function SlackNudgeNote() {
  return (
    <p className='text-muted-foreground border-t pt-[10px] text-[11.5px] leading-[1.45]'>
      <span className='text-warning-muted-foreground font-semibold'>Slack nudges pending</span> —
      posting integration not yet built. Overdue items are not auto-flagged to anyone yet.
    </p>
  );
}
