import { Panel } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import type { WeeklyPerformanceView } from '@/lib/brief-view';

/**
 * Six-week brief volume against quota.
 *
 * ⚠️ SHARED by the creative department panel and the Briefs & quota screen.
 *
 * ⚠️ REAL COUNTS, with a documented SUBSTITUTION. Decision 6 says the quota counts
 * APPROVED briefs; Vision emits no `brief.approved` event at all, so the series
 * counts SUBMISSIONS and both the title and a caption say so. Every bar is a real
 * count of real events — this is a data gap surfaced, not a mock.
 *
 * ⚠️ Bars are NEUTRAL when no quota is configured. Every `quota_config` is `{}`
 * today, and an unconfigured quota is not a zero quota — colouring every bar
 * "below target" against a threshold nobody set would be a fabricated judgement.
 *
 * ⚠️ The mockup's exception annotation ("W31 dip = product launch freeze") is
 * OMITTED — there is no exception field and nowhere to store one (audit D8).
 */
export function WeeklyPerformanceChart({ data }: { data: WeeklyPerformanceView }) {
  const peak = Math.max(...data.bars.map((b) => b.count), data.quota ?? 0, 1);

  return (
    <Panel
      title={
        data.usesSubmittedFallback
          ? 'Briefs submitted vs quota, last 6 weeks'
          : 'Briefs approved vs quota, last 6 weeks'
      }
    >
      {data.usesSubmittedFallback && (
        <p className='text-muted-foreground text-[11.5px] leading-[1.45]'>
          Counting <span className='font-semibold'>submissions</span>: Vision emits no
          brief-approved event yet, so approvals cannot be derived.
        </p>
      )}

      <div className='flex h-[128px] items-end gap-[10px]'>
        {data.bars.map((b) => {
          const tone =
            data.quota === null
              ? 'bg-muted-foreground/40'
              : b.count >= data.quota
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
        {data.quota === null
          ? 'No weekly quota configured — bars show volume only.'
          : `Quota: ${data.quota}/wk team-wide.`}
      </p>
    </Panel>
  );
}
