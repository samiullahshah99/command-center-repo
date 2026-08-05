'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSuspenseQuery } from '@tanstack/react-query';
import { AgentPerformanceTable } from '@/components/agent-performance-table';
import { BriefBacklogTable } from '@/components/brief-backlog-table';
import { WeeklyPerformanceChart } from '@/components/weekly-performance-chart';
import { Icons } from '@/components/icons';
import { TeamMemberList } from '@/components/team-member-list';
import { Progress } from '@/components/ui/progress';
import { EmptyState, Panel, Row, ROW_META, RowList, Screen, StatCard } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { formatDueDate } from '@/lib/format-date';
import { ROW_TONE, rowStateLabel, rowTone } from '@/lib/row-tone';
import { departmentQueryOptions } from '../api/queries';
import type { DepartmentDetail } from '../api/types';
import { HEALTH_BADGE, HEALTH_LABEL, PROJECT_STATUS_META } from '../constants/department-options';

/**
 * Department detail.
 *
 * ⚠️ ONE surface here is invented: the CX panel's agent FIGURES (Zendesk unbuilt),
 * and it carries its own caption from the shared table. Everything else — health,
 * stats, projects, items, risks, members, the brief backlog and the 6-week series —
 * is a real query.
 *
 * ⚠️ THE HEALTH BADGE SHARES ITS SOURCE with the sidebar dot, the Control Tower
 * card and My team: `getDeptItems()` + one `computeDeptHealth()` call. Four
 * surfaces, one path.
 */
export function DepartmentBody({ departmentId, nowIso }: { departmentId: string; nowIso: string }) {
  const { data } = useSuspenseQuery(departmentQueryOptions(departmentId, nowIso));

  // ⚠️ ONE `now` for the subtree, from the SERVER's value. A per-render clock
  // differs between SSR and hydration and React discards the subtree.
  const now = useMemo(() => new Date(data?.now ?? nowIso), [data?.now, nowIso]);

  // The route already 404s an unknown id; this is the type guard, not a state.
  if (!data) return null;

  return (
    <Screen>
      <Link
        href='/dashboard/overview'
        className='text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-[4px] text-[12px] transition-colors'
      >
        <Icons.chevronLeft className='size-[13px]' aria-hidden />
        Control Tower
      </Link>

      <Header data={data} />

      <div className='grid gap-[14px] sm:grid-cols-2 lg:grid-cols-4'>
        <StatCard
          size='md'
          label='Open items'
          value={data.stats.open}
          sub={`${data.stats.overdue} overdue`}
          subClassName={cn(data.stats.overdue > 0 && 'text-destructive font-semibold')}
        />
        <StatCard
          size='md'
          label='Blocked'
          value={data.stats.blocked}
          sub={data.stats.blocked > 0 ? 'waiting on something' : 'none'}
          subClassName={cn(data.stats.blocked > 0 && 'text-destructive font-semibold')}
        />
        <StatCard
          size='md'
          label='At risk'
          value={data.stats.atRisk}
          sub={data.stats.atRisk > 0 ? 'flagged' : 'none'}
          subClassName={cn(data.stats.atRisk > 0 && 'text-warning-muted-foreground font-semibold')}
        />
        <StatCard size='md' label='People' value={data.stats.people} sub='in this department' />
      </div>

      <div className='grid items-start gap-[14px] lg:grid-cols-[3fr_2fr]'>
        <CurrentProjects data={data} now={now} />
        <RiskPanel data={data} />
      </div>

      {/* Conditional panel, keyed on dept_type. Other types get neither. */}
      {data.briefs && (
        <div className='grid items-start gap-[14px] lg:grid-cols-[3fr_2fr]'>
          <BriefBacklogTable rows={data.briefs.backlog} />
          <WeeklyPerformanceChart data={data.briefs.performance} />
        </div>
      )}
      {data.agents && <AgentPerformanceTable data={data.agents} />}

      <TeamMemberList
        members={data.members}
        emptyCopy='No people assigned to this department yet.'
      />
    </Screen>
  );
}

function Header({ data }: { data: DepartmentDetail }) {
  return (
    <div className='flex flex-col gap-[6px]'>
      <div className='flex flex-wrap items-center gap-[10px]'>
        {/* 10px accent dot — the same token the sidebar's department row uses. */}
        <span
          aria-hidden
          className='size-[10px] shrink-0 rounded-full'
          style={{ backgroundColor: data.department.accentVar }}
        />
        <h1 className='text-[21px] leading-none font-bold tracking-[-0.01em]'>
          {data.department.name}
        </h1>
        <span
          className={cn(
            'rounded-full border px-[8px] py-px text-[11.5px] font-semibold',
            HEALTH_BADGE[data.health]
          )}
        >
          {HEALTH_LABEL[data.health]}
        </span>
      </div>
      {/*
        ⚠️ A DETERMINISTIC FACTUAL SENTENCE, not a generated summary — every clause
        is a live count, so it carries no "AI generated" chip and no sample flag.
        See the note in ../api/service.ts.
      */}
      <p className='text-muted-foreground max-w-[640px] text-[13px] leading-[1.5]'>
        {data.summary}
      </p>
    </div>
  );
}

function CurrentProjects({ data, now }: { data: DepartmentDetail; now: Date }) {
  return (
    <div className='flex flex-col gap-[14px]'>
      <Panel title={`Current projects · ${data.projects.length}`}>
        {data.projects.length === 0 ? (
          <EmptyState
            icon={<Icons.workspace className='size-5' />}
            title='No active projects'
            detail='Projects appear here once this department has open work in one.'
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
                      {p.leadName ?? 'No lead'} · {p.openCount} open of {p.totalCount}
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
                    TODO(backend): project.due — a deliberate migration, not
                    something to add here.
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

      <Panel title={`Open items · ${data.items.length}`} bodyClassName='divide-y'>
        {data.items.length === 0 ? (
          <EmptyState
            icon={<Icons.check className='size-5' />}
            title='Nothing open'
            detail='Open items owned by this department appear here.'
          />
        ) : (
          data.items.map((item) => {
            const due = formatDueDate(item.dueDate, now);
            const toneInput = {
              status: item.status,
              overdue: due.overdue,
              riskFlag: item.riskFlag
            };
            const tone = rowTone(toneInput);

            return (
              <div
                key={item.id}
                className={cn(
                  'grid grid-cols-[9px_1fr_auto] items-center gap-x-[10px] gap-y-[2px] py-[10px]',
                  'sm:grid-cols-[9px_1fr_auto_auto_auto] sm:gap-x-[12px]'
                )}
              >
                <span
                  aria-hidden
                  className={cn('size-[9px] shrink-0 rounded-full', ROW_TONE[tone].dot)}
                />

                <div className='col-start-2 min-w-0'>
                  <p className='truncate text-[13px] font-semibold'>
                    {item.title ?? (
                      <span className='text-muted-foreground font-normal italic'>
                        title held in the source system
                      </span>
                    )}
                  </p>
                  <p className='text-muted-foreground truncate text-[11.5px]'>
                    {item.projectName ?? 'Unfiled'}
                  </p>
                </div>

                <span className='text-muted-foreground col-start-3 row-start-1 shrink-0 truncate text-[12px] sm:w-[92px]'>
                  {item.ownerName ?? 'Unowned'}
                </span>

                <span
                  className={cn(
                    'col-start-2 text-[12px] tabular-nums sm:col-start-4 sm:w-[100px] sm:text-right',
                    due.overdue ? 'text-destructive font-semibold' : 'text-muted-foreground',
                    due.absent && 'italic'
                  )}
                >
                  {due.label}
                </span>

                <span
                  className={cn(
                    'col-start-3 row-start-2 text-[11.5px] font-semibold sm:col-start-5 sm:row-start-1 sm:w-[82px] sm:text-right',
                    ROW_TONE[tone].text
                  )}
                >
                  {rowStateLabel(toneInput)}
                </span>
              </div>
            );
          })
        )}
      </Panel>
    </div>
  );
}

function RiskPanel({ data }: { data: DepartmentDetail }) {
  return (
    <Panel title='At risk / blocked' meta={data.risks.length > 0 ? 'worst first' : undefined}>
      {data.risks.length === 0 ? (
        <EmptyState
          icon={<Icons.check className='size-5' />}
          title='Nothing at risk'
          detail='No overdue, blocked or flagged work in this department.'
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
    </Panel>
  );
}
