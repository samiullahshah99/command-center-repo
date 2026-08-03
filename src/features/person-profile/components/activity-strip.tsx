import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { formatMeetingDate } from '@/lib/format-date';
import { SOURCE_BADGE, activityEmptyCopy } from '../constants/profile-options';
import type { ActivityGap, ProfileEvent } from '../api/types';

/**
 * "Last observed activity" — the chase-killer.
 *
 * Observable signals only: what the connectors saw, not what anyone reported.
 * That is the whole point — it answers "has X been moving?" without a DM.
 */
export function ActivityStrip({
  events,
  gap,
  personName
}: {
  events: ProfileEvent[];
  gap: ActivityGap;
  personName: string;
}) {
  const empty = activityEmptyCopy(gap, personName);

  return (
    <Card>
      <CardContent className='pt-6'>
        <h3 className='mb-1 text-sm font-semibold'>Recent activity</h3>
        <p className='text-muted-foreground mb-3 text-xs'>
          Observed across connected systems — not self-reported.
        </p>

        {empty ? (
          <div className='text-muted-foreground flex flex-col items-start gap-2 py-4 text-sm'>
            <span>{empty}</span>
            {/* Action-shaped: the gap names its own fix and links to it. */}
            {gap === 'no_identities' && (
              <Link
                href='/dashboard/identities'
                className='text-primary inline-flex items-center gap-1 text-xs hover:underline'
              >
                Link accounts
                <Icons.chevronRight className='size-3.5' />
              </Link>
            )}
          </div>
        ) : (
          <ul className='divide-y'>
            {events.map((e) => (
              <li key={e.id} className='flex items-center gap-3 py-2'>
                <Badge
                  variant='outline'
                  className={cn('shrink-0 text-[10px] font-normal', SOURCE_BADGE[e.source])}
                >
                  {e.source}
                </Badge>
                <span className='min-w-0 flex-1 truncate font-mono text-xs'>{e.eventType}</span>
                <span className='text-muted-foreground shrink-0 text-xs'>
                  {formatMeetingDate(e.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
