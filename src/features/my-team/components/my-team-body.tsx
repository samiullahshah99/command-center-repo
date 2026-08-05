'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Icons } from '@/components/icons';
import { SampleDataCaption } from '@/components/sample-data-caption';
import {
  EmptyState,
  LABEL_CAPS,
  Panel,
  Row,
  ROW_META,
  RowList,
  Screen,
  StatCard
} from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { formatDueDate } from '@/lib/format-date';
import { ROW_TONE, rowStateLabel, rowTone } from '@/lib/row-tone';
import { myTeamQueryOptions } from '../api/queries';
import type { MyTeam } from '../api/types';
import { CADENCE_META, HEALTH_BADGE, HEALTH_LABEL } from '../constants/my-team-options';

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

      <AgentPerformanceCard data={data} />

      <div className='grid items-start gap-[14px] lg:grid-cols-[3fr_2fr]'>
        <TeamActionItems data={data} now={now} />
        <RiskPanel data={data} />
      </div>

      <TeamMembers data={data} />
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

/**
 * Agent performance.
 *
 * ⚠️ HYBRID. The AGENT column is real; every figure is invented because Zendesk is
 * unbuilt. The caption is rendered from the data's own `figuresAreSample` flag, so
 * it cannot be shown without it.
 */
function AgentPerformanceCard({ data }: { data: MyTeam }) {
  return (
    <Panel
      title='Agent performance'
      meta={<span className='text-[11.5px]'>via Zendesk · this week</span>}
    >
      {data.agents.figuresAreSample && (
        <SampleDataCaption what='performance figures are sample — Zendesk integration pending. The agents listed are real team members.' />
      )}

      {data.agents.rows.length === 0 ? (
        <p className='text-muted-foreground text-[12.5px]'>No members in this team yet.</p>
      ) : (
        <div className='overflow-x-auto'>
          <div className='min-w-[560px]'>
            <div
              className={cn(
                LABEL_CAPS,
                'grid grid-cols-[1.2fr_0.7fr_0.7fr_0.7fr_0.9fr] gap-[10px] border-b pb-[7px]'
              )}
            >
              <span>Agent</span>
              <span className='text-right'>Tickets</span>
              <span className='text-right'>Resolved</span>
              <span className='text-right'>CSAT</span>
              <span>Cadence</span>
            </div>

            {data.agents.rows.map((a) => (
              <div
                key={a.personId}
                className='grid grid-cols-[1.2fr_0.7fr_0.7fr_0.7fr_0.9fr] gap-[10px] border-b py-[8px] text-[12.5px] last:border-b-0'
              >
                <span className='min-w-0 truncate font-semibold'>{a.name}</span>
                <span className='text-right tabular-nums'>{a.tickets}</span>
                <span className='text-right tabular-nums'>{a.resolved}</span>
                <span className='text-right tabular-nums'>{a.csat.toFixed(1)}</span>
                <span className={cn('font-semibold', CADENCE_META[a.cadence].tone)}>
                  {CADENCE_META[a.cadence].label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
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

/**
 * The member list.
 *
 * ⚠️ Each row is NAVIGATION — a plain `<Link>`, not a `<Button>` wrapping one.
 * `ButtonPrimitive` declares `nativeButton = true`, so composing an `<a>` into it
 * violates its contract and Base UI warns. These rows are not button-styled at all,
 * so `buttonVariants` is not needed either.
 */
function TeamMembers({ data }: { data: MyTeam }) {
  return (
    <Panel title='Team' meta={<span className='text-[11.5px]'>{data.members.length}</span>}>
      {data.members.length === 0 ? (
        <p className='text-muted-foreground text-[12.5px]'>No members assigned to this team yet.</p>
      ) : (
        <div className='divide-y'>
          {data.members.map((m) => (
            <Link
              key={m.id}
              href={m.href}
              className='hover:bg-muted/50 -mx-[6px] flex items-center gap-[10px] rounded-[8px] px-[6px] py-[9px] transition-colors'
            >
              {/* Stable tint hashed from person.id — a token reference, never a
                  colour literal, so it follows the theme through both modes. */}
              <span
                aria-hidden
                className='text-primary-foreground flex size-[32px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold'
                style={{ backgroundColor: m.accentVar }}
              >
                {m.initials}
              </span>

              <span className='flex min-w-0 flex-1 flex-col'>
                <span className='truncate text-[13px] font-semibold'>{m.name}</span>
                <span className={cn(ROW_META, 'truncate')}>
                  {m.roleLabel ?? 'No role assigned'}
                </span>
              </span>

              <span className='text-muted-foreground shrink-0 text-[12px]'>{m.openCount} open</span>
              <Icons.chevronRight className='text-muted-foreground size-[14px] shrink-0' />
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}
