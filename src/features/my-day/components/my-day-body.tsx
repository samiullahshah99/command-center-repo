'use client';

import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { MeetingCard } from '@/components/meeting-card';
import { SampleDataCaption } from '@/components/sample-data-caption';
import { TrackedItemRows } from '@/components/tracked-item-rows';
import { Panel, Row, ROW_META, RowList, Screen, StatCard, TagPill } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { formatDateOnly } from '@/lib/format-date';
import { ROW_TONE } from '@/lib/row-tone';
import { myDayQueryOptions } from '../api/queries';
import type { MyDay, MyRecurringTask } from '../api/types';
import { GREETING_TEXT, RECURRING_STATE } from '../constants/my-day-options';

/**
 * My day — the "me"-scoped screen.
 *
 * ⚠️ THREE SURFACES HERE ARE INVENTED, each labelled from its own `isSample` flag:
 * the Today timeline, the recurring tasks' state + evidence (the ROWS are real),
 * and the latest meeting. Everything else is a real query. See ../api/service.ts
 * and docs/gaps.md.
 *
 * ⚠️ COLOUR IS RATIONED. Red and amber appear in the alerts strip, the overdue
 * signal, and item/recurring state labels. Nothing else is tinted — colour that
 * appears everywhere stops meaning anything, and this page exists so a glance says
 * whether to act.
 */
export function MyDayBody({ personId, nowIso }: { personId: string; nowIso: string }) {
  const { data } = useSuspenseQuery(myDayQueryOptions(personId, nowIso));

  /**
   * ⚠️ ONE `now` for the subtree, from the SERVER's value in the DTO — not a fresh
   * clock. Overdue is a clock comparison; a per-render `new Date()` compares against
   * a different instant on the server than in the browser and mismatches on the
   * boundary, which makes React discard the subtree.
   */
  const now = useMemo(() => new Date(data.now), [data.now]);

  return (
    <Screen width='narrow'>
      <Header data={data} now={now} />

      <span className='text-muted-foreground w-fit self-start rounded-[8px] border px-[8px] py-[3px] text-[12px]'>
        Role profile: {data.person.roleProfileName ?? 'none assigned'}
      </span>

      {data.alerts.length > 0 && <Alerts data={data} />}

      <div className='grid gap-[14px] sm:grid-cols-3'>
        <StatCard
          size='md'
          label='Due today'
          value={data.signals.dueToday}
          sub={`of ${data.signals.open} open`}
        />
        <StatCard
          size='md'
          label='Overdue'
          value={data.signals.overdue}
          sub={data.signals.overdue > 0 ? 'needs attention' : 'all current'}
          subClassName={cn(data.signals.overdue > 0 && 'text-destructive font-semibold')}
        />
        <StatCard size='md' label='Done this week' value={data.signals.doneThisWeek} sub='so far' />
      </div>

      <div className='grid items-start gap-[14px] lg:grid-cols-[3fr_2fr]'>
        <ActionItems data={data} now={now} />

        <div className='flex flex-col gap-[14px]'>
          <TodayCard data={data} />
          <RecurringCard data={data} />
        </div>
      </div>

      {data.latestMeeting.meeting && (
        <div>
          {data.latestMeeting.isSample && (
            <SampleDataCaption what='Fireflies attribution is not built, so this meeting is illustrative.' />
          )}
          <MeetingCard meeting={data.latestMeeting.meeting} title='Latest meeting' />
        </div>
      )}
    </Screen>
  );
}

function Header({ data, now }: { data: MyDay; now: Date }) {
  return (
    <div className='flex flex-wrap items-baseline gap-x-[10px] gap-y-[4px]'>
      <h1 className='text-[21px] leading-none font-bold tracking-[-0.01em]'>
        {GREETING_TEXT[data.greeting]}, {data.person.firstName}
      </h1>
      {/*
        ⚠️ Formatted from the SERVER's `now` through the pinned-locale helper. A bare
        toLocaleDateString() resolves to the host's locale and produced the
        hydration mismatch documented in CLAUDE.md.
      */}
      <span className='text-muted-foreground text-[12.5px]'>
        {formatDateOnly(now.toISOString())}
      </span>
    </div>
  );
}

/**
 * Alerts strip. Worst first, capped in the service.
 *
 * ⚠️ Derived from the same items the list below renders — see the note in the
 * service. An alert about an item the list does not show reads as a ghost.
 */
function Alerts({ data }: { data: MyDay }) {
  return (
    <Card className='gap-0 divide-y p-0'>
      {data.alerts.map((a) => (
        <Row key={a.id} href={a.href} className='px-[16px] py-[10px]'>
          <span
            aria-hidden
            className={cn(
              'size-[8px] shrink-0 rounded-full',
              a.severity === 'destructive' ? 'bg-destructive' : 'bg-warning'
            )}
          />
          <span className='flex min-w-0 flex-1 flex-col'>
            <span className='truncate text-[13px] font-semibold'>{a.text}</span>
            <span className={cn(ROW_META, 'truncate')}>{a.meta}</span>
          </span>
          <TagPill tone={a.severity === 'destructive' ? 'destructive' : 'warning'}>{a.tag}</TagPill>
        </Row>
      ))}
    </Card>
  );
}

/**
 * My action items.
 *
 * ⚠️ The row markup moved to `@/components/tracked-item-rows` when My projects
 * became a fifth consumer of the same anatomy. Only the panel framing lives here.
 */
function ActionItems({ data, now }: { data: MyDay; now: Date }) {
  return (
    <Panel title={`My action items · ${data.items.length}`} bodyClassName='divide-y'>
      <TrackedItemRows
        items={data.items}
        now={now}
        emptyTitle='Nothing assigned'
        emptyDetail='Action items appear here once one is owned by you.'
      />
    </Panel>
  );
}

/**
 * Today's timeline.
 *
 * ⚠️ EVERY VALUE IS INVENTED — there is no calendar integration. `time` arrives
 * pre-formatted from the service; nothing here formats a date.
 */
function TodayCard({ data }: { data: MyDay }) {
  return (
    <Panel title='Today'>
      {data.today.isSample && (
        <SampleDataCaption
          what='calendar integration is not built, so this schedule is illustrative.'
          className='text-muted-foreground text-[11.5px]'
        />
      )}

      {data.today.blocks.length === 0 ? (
        <p className='text-muted-foreground text-[12px] italic'>Nothing scheduled</p>
      ) : (
        <div className='flex flex-col gap-[8px]'>
          {data.today.blocks.map((b) => (
            <div key={b.id} className='flex items-center gap-[10px]'>
              {/* 3px bar in a theme token from the service — never a colour literal. */}
              <span
                aria-hidden
                className='h-[26px] w-[3px] shrink-0 rounded-full'
                style={{ backgroundColor: b.accentVar }}
              />
              <span className='text-muted-foreground w-[42px] shrink-0 text-[11px] tabular-nums'>
                {b.time}
              </span>
              <span className='min-w-0 flex-1 truncate text-[13px] font-semibold'>{b.title}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * Recurring tasks.
 *
 * ⚠️ HYBRID, and the caption says which half. The rows, their cadence and their
 * watched signal are REAL (`recurring_task`, seeded to match the mockup's
 * Automations table). The STATE and EVIDENCE are invented because the completion
 * engine does not exist — `completion_event` has 0 rows and no writer.
 */
function RecurringCard({ data }: { data: MyDay }) {
  return (
    <Panel title='Recurring tasks'>
      <p className='text-muted-foreground -mt-[4px] text-[11px]'>completion read from activity</p>

      {data.recurring.stateIsSample && (
        <SampleDataCaption
          what='the completion engine is not built, so state and evidence are illustrative — the tasks and cadences are real.'
          className='text-muted-foreground text-[11.5px]'
        />
      )}

      {data.recurring.tasks.length === 0 ? (
        <p className='text-muted-foreground text-[12px] italic'>
          No recurring tasks configured for you.
        </p>
      ) : (
        <RowList>
          {data.recurring.tasks.map((t) => (
            <RecurringRow key={t.id} task={t} />
          ))}
        </RowList>
      )}
    </Panel>
  );
}

function RecurringRow({ task }: { task: MyRecurringTask }) {
  const meta = RECURRING_STATE[task.state];

  return (
    <Row className='flex-wrap py-[10px]'>
      <span className='flex min-w-0 flex-1 flex-col'>
        <span className='flex items-center gap-[6px]'>
          <span className='min-w-0 truncate text-[13px] font-semibold'>{task.name}</span>
          <TagPill>{task.cadence}</TagPill>
        </span>
        {/* Real watched signal, then the invented evidence — the caption above
            covers the second half. */}
        <span className={cn(ROW_META, 'mt-[2px] truncate')}>
          {task.watchedSignal} — {task.evidence}
        </span>
      </span>

      <span className={cn('shrink-0 text-[11.5px] font-semibold', ROW_TONE[meta.tone].text)}>
        {meta.label}
      </span>
    </Row>
  );
}
