import { cn } from '@/lib/utils';
import { formatDateOnly } from '@/lib/format-date';
import { MOCKUP_TODAY, daysBetween, gridPercent } from '../../constants';
import { isOverdue, isTerminalStatus, projectById, type MockItem } from '../../fixtures';
import { OwnerAvatar } from '../owner-avatar';

/**
 * One item as a bar on the week grid.
 *
 * ⚠️ AN OVERDUE BAR IS EXTENDED TO THE TODAY-LINE, not drawn to its due date.
 * That is the whole idea of the view: lateness becomes a physical overhang that
 * crosses the line, so a glance at the grid shows how far behind something is
 * without reading a single date. A bar that simply stopped at its due date
 * would make an item three weeks late look identical to one a day late.
 */
export function TimelineBar({ item }: { item: MockItem }) {
  const project = projectById(item.projectId);
  const terminal = isTerminalStatus(item.status);
  const overdue = isOverdue(item, MOCKUP_TODAY);

  if (!item.dueDate) return null;

  const start = item.startDate ?? item.dueDate;
  const left = gridPercent(start);
  // Overdue bars run to today; everything else stops at its due date.
  const right = gridPercent(overdue ? MOCKUP_TODAY : item.dueDate);
  const width = Math.max(2.5, right - left);
  const daysOver = overdue ? daysBetween(item.dueDate, MOCKUP_TODAY) : 0;

  return (
    <div
      className='absolute flex h-7 items-center'
      style={{ left: `${left}%`, width: `${width}%` }}
      title={`${item.title} — due ${formatDateOnly(item.dueDate)}${
        overdue ? ` (${daysOver} days over)` : ''
      }`}
    >
      <div
        className={cn(
          'flex h-full w-full items-center gap-1.5 overflow-hidden rounded-md border px-2',
          overdue ? 'border-red-500/60 bg-red-500/20' : cn(project.accent, 'border-transparent'),
          terminal && 'opacity-45',
          item.status === 'blocked' && !overdue && 'border-dashed'
        )}
      >
        <OwnerAvatar name={item.owner} />
        <span
          className={cn(
            'truncate text-[11px] leading-none font-medium',
            terminal && 'line-through'
          )}
        >
          {item.title}
        </span>
        {overdue && (
          <span className='ml-auto shrink-0 text-[10px] font-bold text-red-700 dark:text-red-300'>
            +{daysOver}d
          </span>
        )}
      </div>
    </div>
  );
}
