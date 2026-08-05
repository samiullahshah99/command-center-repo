import { Icons } from '@/components/icons';
import { EmptyState, TagPill } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { formatDueDate } from '@/lib/format-date';
import { ROW_TONE, rowStateLabel, rowTone } from '@/lib/row-tone';
import type { TrackedItemStatus } from '@/db/schema/tracked-item';

/**
 * What one row needs. Built by each feature's service.
 *
 * ⚠️ `dueDate` is an ISO string, NOT a formatted label — the row calls
 * `formatDueDate(due, now)` itself so overdue styling and the label can never
 * disagree. `now` is threaded in, never read from the clock here.
 */
export type TrackedItemRowView = {
  id: string;
  title: string | null;
  projectName: string | null;
  /** Rendered as a pill when present. Omit to hide the column. */
  sourceLabel?: string | null;
  /** Rendered as a column when present. Omit to hide it. */
  ownerName?: string | null;
  status: TrackedItemStatus;
  dueDate: string | null;
  riskFlag: boolean;
};

/**
 * The tracked-item row: [dot | title + project | source | owner | due | status].
 *
 * ⚠️ EXTRACTED ON ITS FIFTH CONSUMER. This anatomy was written out separately in
 * My day, the person profile, My team, the department page, and now My projects.
 * CLAUDE.md puts shared behaviour in one place; five hand-maintained copies of a
 * row whose overdue styling and status vocabulary must agree is exactly the drift
 * this rule exists to prevent.
 *
 * ⚠️ MIGRATED SO FAR: My day and My projects, which share this exact shape (source
 * pill, no owner). My team, the department page and the person profile still render
 * their own copies — they are near-identical but carry an owner column or an
 * owner-confidence marker, and migrating them was outside the brief that prompted
 * this extraction. `ownerName` is supported here precisely so they can adopt it
 * without a signature change.
 *
 * ⚠️ ONE tone mapping for the dot AND the label, from `@/lib/row-tone`. Two
 * independent mappings read as two signals when they disagree, and the reader
 * trusts neither.
 *
 * ⚠️ PRESENTATIONAL ONLY. No hooks, no fetching.
 */
export function TrackedItemRows({
  items,
  now,
  emptyTitle = 'Nothing assigned',
  emptyDetail = 'Items appear here once one is owned by you.'
}: {
  items: TrackedItemRowView[];
  /** Resolved ONCE above the tree — never `new Date()` inside a renderer. */
  now: Date;
  emptyTitle?: string;
  emptyDetail?: string;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Icons.check className='size-5' />}
        title={emptyTitle}
        detail={emptyDetail}
      />
    );
  }

  return (
    <>
      {items.map((item) => {
        const terminal = item.status === 'done' || item.status === 'cancelled';
        const due = formatDueDate(item.dueDate, now, { terminal });
        const toneInput = { status: item.status, overdue: due.overdue, riskFlag: item.riskFlag };
        const tone = rowTone(toneInput);

        return (
          <div
            key={item.id}
            className={cn(
              'grid grid-cols-[9px_1fr_auto] items-center gap-x-[10px] gap-y-[2px] py-[10px]',
              'sm:grid-cols-[9px_1fr_auto_auto] sm:gap-x-[12px]',
              terminal && 'opacity-55'
            )}
          >
            <span
              aria-hidden
              className={cn('size-[9px] shrink-0 rounded-full', ROW_TONE[tone].dot)}
            />

            <div className='col-start-2 min-w-0'>
              <p className={cn('truncate text-[13px] font-semibold', terminal && 'line-through')}>
                {item.title ?? (
                  <span className='text-muted-foreground font-normal italic'>
                    title held in the source system
                  </span>
                )}
              </p>
              <p className='text-muted-foreground truncate text-[11.5px]'>
                {item.projectName ?? 'Unfiled'}
                {item.ownerName ? ` · ${item.ownerName}` : ''}
              </p>
            </div>

            {item.sourceLabel && (
              <TagPill className='col-start-3 row-start-1'>{item.sourceLabel}</TagPill>
            )}

            <span
              className={cn(
                'col-start-2 text-[12px] tabular-nums sm:col-start-3 sm:w-[104px] sm:text-right',
                due.overdue ? 'text-destructive font-semibold' : 'text-muted-foreground',
                due.absent && 'italic'
              )}
            >
              {due.label}
            </span>

            <span
              className={cn(
                'col-start-3 row-start-2 text-[11.5px] font-semibold sm:col-start-4 sm:row-start-1 sm:w-[82px] sm:text-right',
                ROW_TONE[tone].text
              )}
            >
              {rowStateLabel(toneInput)}
            </span>
          </div>
        );
      })}
    </>
  );
}
