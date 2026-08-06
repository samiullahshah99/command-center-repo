'use client';

import Link from 'next/link';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Icons } from '@/components/icons';
import { SampleDataCaption } from '@/components/sample-data-caption';
import { LABEL_CAPS, Panel, Screen, TagPill } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { automationsQueryOptions } from '../api/queries';
import type { Automations, RoleProfileStatus, RuleStatus } from '../api/types';

/**
 * Role profiles & automations — the ops-lead overview.
 *
 * ⚠️ READ-ONLY. A full role-profile admin already exists at
 * `/dashboard/role-profiles` (list) and `/dashboard/role-profiles/[id]` (edit
 * form); every row here links there. Building a second CRUD would give the same
 * records two edit paths with two validation stories.
 *
 * ⚠️ ONE surface is invented: a rule's FIRED count and last-fired time. The tasks,
 * owners, cadences, watched signals, fallbacks and both status columns are real.
 *
 * ⚠️ BOTH STATUS COLUMNS ARE DERIVED, not stored — neither `role_profile` nor
 * `recurring_task` has a status column. The derivations live in ../api/service.ts
 * so there is one place to change when the rebuild adds real columns.
 */
export function AutomationsBody({ nowIso }: { nowIso: string }) {
  const { data } = useSuspenseQuery(automationsQueryOptions(nowIso));

  return (
    <Screen>
      <div>
        <h1 className='text-[21px] leading-none font-bold tracking-[-0.01em]'>
          Role profiles &amp; automations
        </h1>
        <p className='text-muted-foreground mt-[6px] max-w-[760px] text-[13px] leading-[1.5]'>
          Each role is tracked against the signals that reflect its work. Auto-completion is
          evidenced, never self-declared.
        </p>
      </div>

      <RoleProfilesCard data={data} />
      <RulesCard data={data} />
    </Screen>
  );
}

const PROFILE_STATUS: Record<RoleProfileStatus, { label: string; tone: string }> = {
  live: { label: 'Live', tone: 'text-success-muted-foreground' },
  manual: { label: 'Manual', tone: 'text-muted-foreground' }
};

const PROFILE_COLS = 'grid-cols-[1fr_0.9fr_1.5fr_0.6fr_1.3fr_0.9fr_0.6fr]';

function RoleProfilesCard({ data }: { data: Automations }) {
  return (
    <Panel
      title={`Role profiles · ${data.roleProfiles.length}`}
      meta={
        <Link href='/dashboard/role-profiles' className='text-[11.5px] hover:underline'>
          Manage →
        </Link>
      }
    >
      {data.roleProfiles.length === 0 ? (
        <p className='text-muted-foreground text-[12.5px]'>No role profiles configured.</p>
      ) : (
        <div className='overflow-x-auto'>
          <div className='min-w-[860px]'>
            <div className={cn(LABEL_CAPS, 'grid gap-[10px] border-b pb-[7px]', PROFILE_COLS)}>
              <span>Role</span>
              <span>People</span>
              <span>Tracked signals</span>
              <span>Quota</span>
              <span>Auto-complete rule</span>
              <span>Source</span>
              <span>Status</span>
            </div>

            {data.roleProfiles.map((p) => {
              const status = PROFILE_STATUS[p.status];
              return (
                <div
                  key={p.id}
                  className={cn(
                    'grid items-center gap-[10px] border-b py-[8px] text-[12.5px] last:border-b-0',
                    PROFILE_COLS
                  )}
                >
                  {/*
                    ⚠️ NAVIGATION to the EXISTING admin surface — a plain <Link>, not
                    a <Button> wrapping one (Base UI `nativeButton`). This page does
                    not edit.
                  */}
                  <Link
                    href={p.editHref}
                    className='group flex min-w-0 items-center gap-[5px] font-semibold hover:underline'
                  >
                    <span className='truncate'>{p.name}</span>
                    <Icons.edit
                      className='text-muted-foreground size-[12px] shrink-0 opacity-0 transition-opacity group-hover:opacity-100'
                      aria-label={`Edit ${p.name}`}
                    />
                  </Link>

                  {/* Names on the tooltip rather than in the cell — seven profiles
                      with four names each would make the row unreadable. */}
                  <span
                    className='text-muted-foreground tabular-nums'
                    title={p.peopleNames.length > 0 ? p.peopleNames.join(', ') : undefined}
                  >
                    {p.peopleCount > 0 ? p.peopleCount : '—'}
                  </span>

                  {/* ⚠️ Untyped jsonb — parsed defensively; a malformed value shows
                      an em dash rather than throwing. See ../api/service.ts. */}
                  <span
                    className='text-muted-foreground min-w-0 truncate'
                    title={p.signals.join(' · ')}
                  >
                    {p.signals.length > 0 ? p.signals.join(' · ') : '—'}
                  </span>

                  <span className='text-muted-foreground tabular-nums'>{p.quotaLabel ?? '—'}</span>

                  <span
                    className='text-muted-foreground min-w-0 truncate'
                    title={p.ruleLabel ?? undefined}
                  >
                    {p.ruleLabel ?? 'Manual check-off'}
                  </span>

                  <span className='text-muted-foreground min-w-0 truncate'>
                    {p.sourceLabel ?? '—'}
                  </span>

                  <span className={cn('font-semibold', status.tone)}>{status.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

const RULE_STATUS: Record<RuleStatus, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'text-success-muted-foreground' },
  /**
   * ⚠️ WARNING, NOT DESTRUCTIVE. The PRD plans for this — "where no reliable signal
   * exists, tasks fall back to a lightweight manual check-off" — so it is a known
   * design limitation, not a failure. Red here would put alarm on every task the
   * design expects to be manual. Same call as My day's `manual_required`.
   */
  manual_fallback: { label: 'Manual fallback', tone: 'text-warning-muted-foreground' },
  no_rule: { label: 'No rule', tone: 'text-muted-foreground' }
};

const RULE_COLS = 'grid-cols-[1.2fr_1.6fr_0.7fr_0.5fr]';

function RulesCard({ data }: { data: Automations }) {
  return (
    <Panel
      title='Auto-completion rules'
      meta={<span className='text-[11.5px]'>read activity, don&rsquo;t ask for check-offs</span>}
    >
      {data.firedIsSample && (
        <SampleDataCaption what='fired counts are sample — completion engine pending; the tasks, signals and statuses are real.' />
      )}

      {data.rules.length === 0 ? (
        <p className='text-muted-foreground text-[12.5px]'>No recurring tasks configured.</p>
      ) : (
        <div className='overflow-x-auto'>
          <div className='min-w-[640px]'>
            <div className={cn(LABEL_CAPS, 'grid gap-[10px] border-b pb-[7px]', RULE_COLS)}>
              <span>Recurring task</span>
              <span>Watched signal</span>
              <span className='text-right'>Fired</span>
              <span>Status</span>
            </div>

            {data.rules.map((r) => {
              const status = RULE_STATUS[r.status];
              return (
                <div
                  key={r.id}
                  className={cn(
                    'grid items-center gap-[10px] border-b py-[8px] text-[12.5px] last:border-b-0',
                    RULE_COLS
                  )}
                >
                  <span className='flex min-w-0 flex-col gap-[3px]'>
                    <span className='flex items-center gap-[6px]'>
                      <span className='min-w-0 truncate font-semibold'>{r.task}</span>
                      {/* Cadence pill, consistent with My day's recurring rows. */}
                      <TagPill>{r.cadence}</TagPill>
                    </span>
                    {r.ownerName && (
                      <span className='text-muted-foreground truncate text-[11px]'>
                        {r.ownerName}
                      </span>
                    )}
                  </span>

                  <span className='text-muted-foreground min-w-0 flex-col'>
                    <span className='block truncate'>{r.watchedSignal}</span>
                    {/*
                      ⚠️ Surfaced even when the status says "Active". Two of the five
                      seeded tasks carry BOTH a rule and `fallback_manual`; the rule
                      wins the status (something IS watching), so this is where the
                      real fallback field stays visible rather than being hidden by
                      the derivation.
                    */}
                    {r.fallbackManual && (
                      <span className='text-warning-muted-foreground block text-[11px]'>
                        manual fallback available
                      </span>
                    )}
                  </span>

                  <span className='text-right tabular-nums'>
                    <span className='block'>{r.firedCount > 0 ? `${r.firedCount}×` : '—'}</span>
                    {r.lastFiredLabel && (
                      <span className='text-muted-foreground block text-[11px]'>
                        {r.lastFiredLabel}
                      </span>
                    )}
                  </span>

                  <span className={cn('font-semibold', status.tone)}>{status.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className='text-muted-foreground border-t pt-[10px] text-[11.5px] leading-[1.45]'>
        Where no reliable signal exists, tasks fall back to a lightweight manual check-off.
      </p>
    </Panel>
  );
}
