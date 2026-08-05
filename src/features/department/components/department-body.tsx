'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSuspenseQuery } from '@tanstack/react-query';
import { AgentPerformanceTable } from '@/components/agent-performance-table';
import { Icons } from '@/components/icons';
import { TeamMemberList } from '@/components/team-member-list';
import { Progress } from '@/components/ui/progress';
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
import { departmentQueryOptions } from '../api/queries';
import type { DepartmentDetail } from '../api/types';
import {
  BRIEF_STATE_META,
  HEALTH_BADGE,
  HEALTH_LABEL,
  PROJECT_STATUS_META
} from '../constants/department-options';

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
          <BriefBacklog data={data} />
          <BriefPerformanceChart data={data} />
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

/**
 * Creative-only: the brief backlog.
 *
 * ⚠️ REAL DATA from the shared Vision fold, production-filtered. PRODUCT is always
 * an em dash — Vision carries no product field (audit §3.1) — and OWNER is "—"
 * wherever the actor identity is unlinked, never guessed.
 */
function BriefBacklog({ data }: { data: DepartmentDetail }) {
  const briefs = data.briefs;
  if (!briefs) return null;

  return (
    <Panel
      title={`Brief backlog · ${briefs.backlog.length}`}
      meta={<span className='text-[11.5px]'>via Brief Tracker</span>}
    >
      {briefs.backlog.length === 0 ? (
        <p className='text-muted-foreground text-[12.5px]'>No briefs in flight.</p>
      ) : (
        <div className='overflow-x-auto'>
          <div className='min-w-[520px]'>
            <div
              className={cn(
                LABEL_CAPS,
                'grid grid-cols-[1.6fr_0.7fr_0.9fr_0.5fr_0.8fr] gap-[10px] border-b pb-[7px]'
              )}
            >
              <span>Brief</span>
              <span>Product</span>
              <span>Owner</span>
              <span className='text-right'>Age</span>
              <span>Status</span>
            </div>

            {briefs.backlog.map((b) => {
              const meta = BRIEF_STATE_META[b.state];
              return (
                <div
                  key={b.id}
                  className='grid grid-cols-[1.6fr_0.7fr_0.9fr_0.5fr_0.8fr] gap-[10px] border-b py-[8px] text-[12.5px] last:border-b-0'
                >
                  <span className='min-w-0 truncate font-semibold'>{b.title}</span>
                  <span className='text-muted-foreground'>{b.product}</span>
                  <span className='text-muted-foreground min-w-0 truncate'>{b.owner}</span>
                  <span className='text-right tabular-nums'>{b.ageDays}d</span>
                  <span className={cn('font-semibold', meta.tone)}>{meta.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * Creative-only: the 6-week series.
 *
 * ⚠️ REAL COUNTS, with a documented SUBSTITUTION. Decision 6 says the quota counts
 * APPROVED briefs; Vision emits no `brief.approved` event at all, so the series
 * counts submissions instead and the caption says so. That is a data gap surfaced,
 * not a mock — every bar is a real count of real events.
 *
 * ⚠️ Bars are NEUTRAL when no quota is configured. Every `quota_config` is `{}`
 * today, and an unconfigured quota is not a zero quota — colouring every bar
 * "below target" against a threshold nobody set would be a fabricated judgement.
 */
function BriefPerformanceChart({ data }: { data: DepartmentDetail }) {
  const perf = data.briefs?.performance;
  if (!perf) return null;

  const peak = Math.max(...perf.bars.map((b) => b.count), perf.quota ?? 0, 1);

  return (
    <Panel
      title={
        perf.usesSubmittedFallback
          ? 'Briefs submitted vs quota, last 6 weeks'
          : 'Briefs approved vs quota, last 6 weeks'
      }
    >
      {perf.usesSubmittedFallback && (
        <p className='text-muted-foreground text-[11.5px] leading-[1.45]'>
          Counting <span className='font-semibold'>submissions</span>: Vision emits no
          brief-approved event yet, so approvals cannot be derived.
        </p>
      )}

      <div className='flex h-[128px] items-end gap-[10px]'>
        {perf.bars.map((b) => {
          // Neutral unless a quota exists to compare against — see the header.
          const tone =
            perf.quota === null
              ? 'bg-muted-foreground/40'
              : b.count >= perf.quota
                ? 'bg-success'
                : 'bg-warning';

          return (
            <div key={b.week} className='flex flex-1 flex-col items-center gap-[5px]'>
              <span className='text-[11px] font-semibold tabular-nums'>{b.count || ''}</span>
              <div
                className={cn('w-full rounded-t-[4px]', b.count > 0 ? tone : 'bg-muted')}
                style={{ height: b.count > 0 ? `${Math.max(8, (b.count / peak) * 100)}%` : '2px' }}
                title={`${b.week}: ${b.count}`}
              />
              <span className='text-muted-foreground text-[10.5px]'>{b.week}</span>
            </div>
          );
        })}
      </div>

      <p className='text-muted-foreground text-[11.5px]'>
        {perf.quota === null
          ? 'No weekly quota configured — bars show volume only.'
          : `Quota: ${perf.quota}/wk team-wide.`}
      </p>
    </Panel>
  );
}
