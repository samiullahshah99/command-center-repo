import { Panel, TagPill } from '@/components/ui/panel';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { formatDueDate } from '@/lib/format-date';
import type { ProfileItem } from '../api/types';
import { ROW_TONE, rowStateLabel, rowTone } from '../constants/profile-options';

const NEEDS_REVIEW = ['fuzzy', 'unresolved'];

/**
 * The Tasks tab: one card, one row per item.
 *
 * ⚠️ FLAT, NOT GROUPED BY STATUS. This previously rendered five status sections
 * with their own sub-headers, which is the board's shape. The mockup gives the
 * profile a single sorted list, and it is the better read here: on a profile the
 * question is "what is this person carrying, worst first", and status-grouping
 * buries an overdue item under a section heading. The board still groups — that
 * is where lanes are the point.
 *
 * ⚠️ `now` is threaded in from the page, resolved once. Never `Date.now()` here:
 * overdue is a clock comparison, and computing it per row compares against a
 * different instant on the server than in the browser, which mismatches on the
 * boundary and makes React discard the subtree. See CLAUDE.md.
 */
export function ProfileItemList({ items, now }: { items: ProfileItem[]; now: Date }) {
  if (items.length === 0) {
    return (
      <Panel>
        <p className='text-muted-foreground py-8 text-center text-sm'>Nothing assigned.</p>
      </Panel>
    );
  }

  return (
    <Panel bodyClassName='divide-y'>
      {items.map((item) => {
        const terminal = item.status === 'done' || item.status === 'cancelled';
        const due = formatDueDate(item.dueDate, now, { terminal });
        const tone = rowTone({
          status: item.status,
          overdue: due.overdue,
          riskFlag: item.riskFlag
        });
        const label = rowStateLabel({
          status: item.status,
          overdue: due.overdue,
          riskFlag: item.riskFlag
        });
        const uncertain =
          item.originOwnerConfidence !== null && NEEDS_REVIEW.includes(item.originOwnerConfidence);

        return (
          <div
            key={item.id}
            className={cn(
              'grid grid-cols-[16px_1fr_auto] items-center gap-x-[10px] gap-y-[2px] py-[10px]',
              'sm:grid-cols-[16px_1fr_auto_auto_auto] sm:gap-x-[12px]',
              terminal && 'opacity-55'
            )}
          >
            {/* 16px cell, 8px dot — the dot is the row's state at a glance. */}
            <span className='flex size-[16px] items-center justify-center'>
              <span className={cn('size-[8px] rounded-full', ROW_TONE[tone].dot)} aria-hidden />
            </span>

            <div className='col-start-2 min-w-0'>
              <div className='flex items-center gap-[6px]'>
                <span
                  className={cn(
                    'min-w-0 truncate text-[13px] font-semibold',
                    terminal && 'line-through'
                  )}
                >
                  {item.title ?? (
                    <span className='text-muted-foreground font-normal italic'>
                      title held in the source system
                    </span>
                  )}
                </span>
                {/* Owner-confidence marker, same subtle treatment as the board:
                    this item's owner began as a name-similarity guess a human
                    waved through — worth a second look, not an alarm. */}
                {uncertain && (
                  <Icons.alertCircle
                    className='text-warning-muted-foreground size-[13px] shrink-0'
                    aria-label={`Owner match was '${item.originOwnerConfidence}' — unverified`}
                  />
                )}
              </div>
              <p className='text-muted-foreground truncate text-[11.5px]'>
                {item.projectName ?? 'Unfiled'}
              </p>
            </div>

            <TagPill className='col-start-3 row-start-1'>{item.sourceLabel}</TagPill>

            <span
              className={cn(
                'col-start-2 text-[11.5px] tabular-nums sm:col-start-4 sm:w-[110px] sm:text-right',
                due.overdue ? 'text-destructive font-semibold' : 'text-muted-foreground',
                due.absent && 'italic'
              )}
            >
              {due.label}
            </span>

            <span
              className={cn(
                'col-start-3 row-start-2 text-[11.5px] font-semibold sm:col-start-5 sm:row-start-1 sm:w-[86px] sm:text-right',
                ROW_TONE[tone].text
              )}
            >
              {label}
            </span>
          </div>
        );
      })}
    </Panel>
  );
}
