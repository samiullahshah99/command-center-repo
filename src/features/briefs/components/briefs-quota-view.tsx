'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { BriefBacklogTable } from '@/components/brief-backlog-table';
import { WeeklyPerformanceChart } from '@/components/weekly-performance-chart';
import { Progress } from '@/components/ui/progress';
import { Card } from '@/components/ui/card';
import { LABEL_CAPS, Screen, StatCard } from '@/components/ui/panel';
import { briefsQuotaScreenOptions } from '../api/queries';
import type { BriefsQuotaScreen } from '../api/types';

/**
 * Briefs & quota — the creative persona's home screen.
 *
 * ⚠️ TWO surfaces here are invented, each flagged by its own data: the
 * calendar-aware NUDGE line and the AD TESTING card. The quota count, the week,
 * the turnaround, the backlog and the 6-week series are all real.
 *
 * ⚠️ THE QUOTA COUNTS SUBMISSIONS, changed from `brief.created` on 2026-08-06.
 * Decision 6 says it should count APPROVED briefs and Vision emits no such event,
 * so submissions are the closest measurable proxy — captioned by the shared chart.
 *
 * ⚠️ The backlog and the chart are the SHARED components the department page
 * renders, so a creative and an ops lead looking at the same week see the same
 * numbers.
 */
export function BriefsQuotaView({ personId, nowIso }: { personId: string; nowIso: string }) {
  const { data } = useSuspenseQuery(briefsQuotaScreenOptions(personId, nowIso));

  return (
    <Screen width='narrow'>
      <div>
        <h1 className='text-[21px] leading-none font-bold tracking-[-0.01em]'>
          Briefs &amp; quota
        </h1>
        <p className='text-muted-foreground mt-[6px] text-[13px]'>
          Submissions auto-tracked from the Brief Tracker — no manual check-offs.
        </p>
      </div>

      <div className='grid gap-[14px] lg:grid-cols-[2fr_1fr_1fr]'>
        <QuotaHero data={data} />

        <StatCard
          size='md'
          label='Avg turnaround'
          value={data.turnaround.avgDays === null ? '—' : `${data.turnaround.avgDays}d`}
          sub={
            data.turnaround.avgDays === null
              ? 'no submissions yet'
              : `concept → brief · ${data.turnaround.sampleSize} briefs`
          }
        />

        <AdTestingCard data={data} />
      </div>

      <div className='grid items-start gap-[14px] lg:grid-cols-[3fr_2fr]'>
        <BriefBacklogTable rows={data.backlog} />
        <WeeklyPerformanceChart data={data.performance} />
      </div>
    </Screen>
  );
}

/**
 * The hero quota card.
 *
 * ⚠️ NO BAR AND NO "/ target" WHEN UNCONFIGURED. Every `quota_config` is `{}`
 * today, and an unconfigured quota is not a zero quota — a 0-of-0 bar reads as
 * failure against a target nobody set. The submitted count is still shown, because
 * it is real and useful on its own.
 */
function QuotaHero({ data }: { data: BriefsQuotaScreen }) {
  const { submitted, target, week, nudge, nudgeIsSample } = data.quota;
  const configured = target !== null && target > 0;
  const pct = configured ? Math.min(100, Math.round((submitted / target) * 100)) : 0;

  return (
    <Card className='gap-[8px] p-[18px]'>
      <div className={LABEL_CAPS}>This week&rsquo;s quota</div>

      <div className='text-[26px] leading-none font-bold tabular-nums'>
        {configured ? `${submitted} / ${target}` : submitted}
      </div>
      <div className='text-muted-foreground text-[12px]'>briefs submitted · {week}</div>

      {configured && <Progress value={pct} className='mt-[4px] h-[6px]' />}

      {configured ? (
        nudge && (
          <p className='text-muted-foreground text-[11.5px] leading-[1.45]'>
            {/*
              ⚠️ The nudge is INVENTED — Calendar has no integration at all (audit
              §2.12), so the scheduling advice is a placeholder. Marked inline rather
              than with a full caption block: it is one line inside a card whose
              other numbers are real, and a block caption would read as covering
              them too.
            */}
            {nudgeIsSample && (
              <span className='text-warning-muted-foreground font-semibold'>Sample nudge — </span>
            )}
            {nudge}
          </p>
        )
      ) : (
        <p className='text-muted-foreground text-[11.5px]'>no weekly quota configured</p>
      )}
    </Card>
  );
}

/**
 * ⚠️ WHOLLY INVENTED. `BRIEF_STATES` has no `in_testing` or `winner`, there is no
 * ad-testing table and no source emits one (audit §2.12).
 */
function AdTestingCard({ data }: { data: BriefsQuotaScreen }) {
  const { inTesting, winners, isSample } = data.adTesting;

  return (
    <Card className='gap-[5px] p-[18px]'>
      <div className={LABEL_CAPS}>In ad testing</div>
      <div className='text-[21px] leading-none font-bold tabular-nums'>{inTesting}</div>
      <div className='text-muted-foreground text-[11.5px]'>
        {winners.length > 0 ? `${winners.length} early winner` : 'no winners yet'}
      </div>
      {isSample && (
        <p className='text-warning-muted-foreground mt-[2px] text-[10.5px] font-semibold'>
          Sample data — no ad-testing pipeline
        </p>
      )}
    </Card>
  );
}
