'use client';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format-date';
import type { ActivityDay, LastSeen } from '../api/types';

/**
 * 14-day activity sparkline — shape over precision, no axes.
 *
 * ⚠️ THE EMPTY STATE IS THE PRIMARY STATE, not a fallback. Measured on real
 * data: 286 events, 11 attributed to a person, and the newest attributed event
 * is older than this window. So this renders empty for essentially the whole
 * team today, and it has to look deliberate rather than broken. It says
 * "no activity in 14 days" in words, and still shows the last-seen line
 * underneath when there is any history at all.
 *
 * ⚠️ NO Date.now() anywhere. Both the window and every relative label derive
 * from the single `now` the service resolved, threaded down as a prop. A bar
 * chart whose buckets are computed from a per-render clock mismatches between
 * server and browser by construction — the class of bug that blanked the
 * extraction table.
 *
 * ⚠️ Deliberately NOT sortable or comparable. There is no "most active" column
 * and no ranking: on a seven-person team an activity ranking is a surveillance
 * artefact, and event volume measures how chatty a person's tools are, not their
 * contribution.
 */
export function ActivitySparkline({
  activity,
  activityTotal,
  lastSeen,
  now,
  className
}: {
  activity: ActivityDay[];
  activityTotal: number;
  lastSeen: LastSeen;
  now: Date;
  className?: string;
}) {
  // Scale to this person's own peak, never to a global maximum: the bar heights
  // describe one person's rhythm. A shared scale would turn the column into a
  // cross-person comparison, which is the thing this page must not do.
  const peak = Math.max(...activity.map((d) => d.count), 1);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {activityTotal > 0 ? (
        <div
          className='flex h-6 items-end gap-[2px]'
          role='img'
          aria-label={`${activityTotal} events in the last ${activity.length} days`}
        >
          {activity.map((d) => (
            <div
              key={d.day}
              title={`${d.day}: ${d.count} event${d.count === 1 ? '' : 's'}`}
              className={cn('w-1 rounded-sm', d.count > 0 ? 'bg-muted-foreground/50' : 'bg-muted')}
              // Zero days keep a 2px stub so the 14-day window stays legible as
              // a window rather than collapsing to only the active days.
              style={{ height: d.count > 0 ? `${Math.max(15, (d.count / peak) * 100)}%` : '2px' }}
            />
          ))}
        </div>
      ) : (
        <span className='text-muted-foreground text-xs'>no activity in 14 days</span>
      )}

      {lastSeen ? (
        <span className='text-muted-foreground text-xs'>
          <span className='capitalize'>{lastSeen.source}</span> ·{' '}
          {formatRelativeTime(lastSeen.at, now)}
        </span>
      ) : (
        // "Never seen" and "quiet lately" are different facts and must not
        // collapse into one another.
        <span className='text-muted-foreground/70 text-xs'>never seen</span>
      )}
    </div>
  );
}
