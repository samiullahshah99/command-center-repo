import { Badge } from '@/components/ui/badge';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { formatDueDate } from '@/lib/format-date';
import { STATUS_META } from '@/features/tracker/constants/tracker-options';
import { MOCKUP_TODAY, daysBetween, mockupNow } from '../../constants';
import { isOverdue, isTerminalStatus, projectById, type MockItem } from '../../fixtures';

/** Compact one-line-per-item list. Overdue first, then by due date. */
export function PersonItemList({ items }: { items: MockItem[] }) {
  const sorted = items.toSorted((a, b) => {
    const ao = isOverdue(a, MOCKUP_TODAY) ? 0 : 1;
    const bo = isOverdue(b, MOCKUP_TODAY) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
  });

  if (sorted.length === 0) {
    return <p className='text-muted-foreground py-8 text-center text-sm'>Nothing assigned.</p>;
  }

  return (
    <ul className='divide-y'>
      {sorted.map((item) => {
        const project = projectById(item.projectId);
        const terminal = isTerminalStatus(item.status);
        const overdue = isOverdue(item, MOCKUP_TODAY);
        const due = formatDueDate(item.dueDate, mockupNow(), { terminal });
        const daysOver = overdue && item.dueDate ? daysBetween(item.dueDate, MOCKUP_TODAY) : 0;

        return (
          <li
            key={item.id}
            className={cn('flex items-center gap-3 py-2.5', terminal && 'opacity-55')}
          >
            <span
              className={cn('size-2 shrink-0 rounded-full', STATUS_META[item.status].dot)}
              title={STATUS_META[item.status].label}
            />

            <span className={cn('min-w-0 flex-1 truncate text-sm', terminal && 'line-through')}>
              {item.title}
            </span>

            {item.riskFlag && !terminal && (
              <Icons.alertCircle className='size-3.5 shrink-0 text-red-500' aria-label='At risk' />
            )}

            <Badge
              variant='outline'
              className={cn(
                'hidden shrink-0 text-[10px] font-normal sm:inline-flex',
                project.accent
              )}
            >
              {project.name}
            </Badge>

            <span
              className={cn(
                'w-[150px] shrink-0 text-right text-xs',
                overdue && 'font-semibold text-red-600 dark:text-red-400',
                due.dueToday && 'font-semibold text-amber-700 dark:text-amber-300',
                due.absent && 'text-muted-foreground italic'
              )}
            >
              {due.label}
              {overdue && <span className='ml-1'>· {daysOver}d over</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
