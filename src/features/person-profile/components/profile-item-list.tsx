import { Badge } from '@/components/ui/badge';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { formatDueDate, formatMeetingDate } from '@/lib/format-date';
import { STATUS_META } from '@/features/tracker/constants/tracker-options';
import { TRACKED_ITEM_STATUSES } from '@/db/schema/tracked-item';
import type { ProfileItem } from '../api/types';

const NEEDS_REVIEW = ['fuzzy', 'unresolved'];

/**
 * Items grouped by status, reusing the board's lane vocabulary so a reader
 * moving between the two sees the same colours mean the same things.
 *
 * `now` is threaded in from the page, resolved once server-side — never
 * Date.now() here. See CLAUDE.md.
 */
export function ProfileItemList({ items, now }: { items: ProfileItem[]; now: Date }) {
  const groups = TRACKED_ITEM_STATUSES.map((status) => ({
    status,
    items: items.filter((i) => i.status === status)
  })).filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return <p className='text-muted-foreground py-8 text-center text-sm'>Nothing assigned.</p>;
  }

  return (
    <div className='flex flex-col gap-5'>
      {groups.map((g) => {
        const meta = STATUS_META[g.status];
        const terminal = g.status === 'done' || g.status === 'cancelled';

        return (
          <section key={g.status}>
            <header className='mb-1.5 flex items-center gap-2'>
              <span className={cn('size-2 rounded-full', meta.dot)} />
              <h4 className='text-xs font-semibold'>{meta.label}</h4>
              <span className='text-muted-foreground text-xs'>{g.items.length}</span>
            </header>

            <ul className='divide-y'>
              {g.items.map((item) => {
                const due = formatDueDate(item.dueDate, now, { terminal });
                const uncertain =
                  item.originOwnerConfidence !== null &&
                  NEEDS_REVIEW.includes(item.originOwnerConfidence);

                return (
                  <li
                    key={item.id}
                    className={cn('flex items-center gap-3 py-2', terminal && 'opacity-55')}
                  >
                    <span
                      className={cn('min-w-0 flex-1 truncate text-sm', terminal && 'line-through')}
                    >
                      {item.title ?? (
                        <span className='text-muted-foreground italic'>
                          title held in the source system
                        </span>
                      )}
                    </span>

                    {item.riskFlag && !terminal && (
                      <Icons.alertCircle
                        className='size-3.5 shrink-0 text-destructive'
                        aria-label='At risk'
                      />
                    )}

                    {/* Owner-confidence marker, same subtle treatment as the board:
                        this item's owner began as a name-similarity guess a human
                        waved through, which is worth a second look, not an alarm. */}
                    {uncertain && (
                      <Icons.alertCircle
                        className='size-3.5 shrink-0 text-warning-muted-foreground'
                        aria-label={`Owner match was '${item.originOwnerConfidence}' — unverified`}
                      />
                    )}

                    {item.projectName && (
                      <Badge
                        variant='outline'
                        className='hidden shrink-0 text-[10px] font-normal sm:inline-flex'
                      >
                        {item.projectName}
                      </Badge>
                    )}

                    <span
                      className={cn(
                        'w-[130px] shrink-0 text-right text-xs',
                        due.overdue && 'font-semibold text-destructive',
                        due.dueToday && 'font-semibold text-warning-muted-foreground',
                        due.absent && 'text-muted-foreground italic'
                      )}
                    >
                      {due.label}
                    </span>

                    <span className='text-muted-foreground hidden w-[150px] shrink-0 text-right text-[11px] lg:block'>
                      {item.lastUpdateAt ? formatMeetingDate(item.lastUpdateAt) : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
