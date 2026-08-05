'use client';

import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Icons } from '@/components/icons';
import { AgentPerformanceTable } from '@/components/agent-performance-table';
import { TeamMemberList } from '@/components/team-member-list';
import { EmptyState, Panel, Row, ROW_META, RowList, Screen, StatCard } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { formatDueDate } from '@/lib/format-date';
import { ROW_TONE, rowStateLabel, rowTone } from '@/lib/row-tone';
import { myTeamQueryOptions } from '../api/queries';
import type { MyTeam } from '../api/types';
import { HEALTH_BADGE, HEALTH_LABEL } from '../constants/my-team-options';

/**
 * My team — the support manager's department view.
 *
 * ⚠️ ONE surface here is invented: the Agent-performance FIGURES. Zendesk has no
 * code at all, so tickets/resolved/CSAT/cadence are illustrative while the AGENTS
 * themselves are real department members. The card's caption says exactly that.
 * Everything else on the page is a real query. See ../api/service.ts and
 * docs/gaps.md.
 *
 * ⚠️ THE HEALTH BADGE SHARES ITS SOURCE WITH THE SIDEBAR'S DOT — both derive from
 * `getDeptItems()` and one `computeDeptHealth()` call, so they cannot disagree.
 */
export function MyTeamBody({ departmentId, nowIso }: { departmentId: string; nowIso: string }) {
  const { data } = useSuspenseQuery(myTeamQueryOptions(departmentId, nowIso));

  // ⚠️ ONE `now` for the subtree, from the SERVER's value. A per-render clock
  // differs between SSR and hydration and React discards the subtree.
  const now = useMemo(() => new Date(data.now), [data.now]);

  return (
    <Screen width='narrow'>
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
        <StatCard size='md' label='Members' value={data.stats.members} sub='in this team' />
      </div>

      <AgentPerformanceTable data={data.agents} />

      <div className='grid items-start gap-[14px] lg:grid-cols-[3fr_2fr]'>
        <TeamActionItems data={data} now={now} />
        <RiskPanel data={data} />
      </div>

      <TeamMemberList members={data.members} emptyCopy='No members assigned to this team yet.' />
    </Screen>
  );
}

function Header({ data }: { data: MyTeam }) {
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
          My team — {data.department.name}
        </h1>
        <span
          className={cn(
            'rounded-full border px-[8px] py-px text-[11.5px] font-semibold',
            HEALTH_BADGE[data.health]
          )}
          title={
            data.healthReasons.length > 0
              ? data.healthReasons.join(' · ')
              : 'No overdue or blocked work'
          }
        >
          {HEALTH_LABEL[data.health]}
        </span>
      </div>
      {/* ⚠️ AMENDMENT RELABEL — the mockup says "tracked in ClickUp". */}
      <p className='text-muted-foreground max-w-[720px] text-[13px] leading-[1.5]'>
        Agent visibility via Zendesk · action items from the weekly CX sync tracked on the Command
        Center tracker.
      </p>
    </div>
  );
}

function TeamActionItems({ data, now }: { data: MyTeam; now: Date }) {
  return (
    <Panel title={`Team action items · ${data.items.length}`} bodyClassName='divide-y'>
      {data.items.length === 0 ? (
        <EmptyState
          icon={<Icons.check className='size-5' />}
          title='Nothing open'
          detail='Open items owned by this team appear here.'
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

              <span className='text-muted-foreground col-start-3 row-start-1 shrink-0 truncate text-[12px] sm:col-start-3 sm:w-[92px]'>
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
  );
}

function RiskPanel({ data }: { data: MyTeam }) {
  return (
    <Panel title='At risk / blocked' meta={data.risks.length > 0 ? 'worst first' : undefined}>
      {data.risks.length === 0 ? (
        <EmptyState
          icon={<Icons.check className='size-5' />}
          title='Nothing at risk'
          detail='No overdue, blocked or flagged work in this team.'
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
