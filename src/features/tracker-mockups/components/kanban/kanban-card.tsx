import { Badge } from '@/components/ui/badge';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { formatDueDate } from '@/lib/format-date';
import { MOCKUP_TODAY, daysBetween, mockupNow } from '../../constants';
import { isOverdue, isTerminalStatus, projectById, type MockItem } from '../../fixtures';
import { OwnerAvatar } from '../owner-avatar';

/**
 * One card.
 *
 * ⚠️ OVERDUE IS ESCALATED THREE WAYS — a red left rule, a red due chip, and an
 * explicit "N days over" count. One signal is easy to miss in a dense column,
 * and the whole point of the view is that lateness is legible at a glance from
 * across a room during a review. Terminal items are dimmed and struck instead,
 * so a done card never competes for attention.
 */
export function KanbanCard({
  item,
  showProject = true
}: {
  item: MockItem;
  showProject?: boolean;
}) {
  const project = projectById(item.projectId);
  const terminal = isTerminalStatus(item.status);
  const overdue = isOverdue(item, MOCKUP_TODAY);

  // `now` comes from the frozen mockup reference, never Date.now(). See
  // constants.ts — live features thread a real `now` down instead.
  const due = formatDueDate(item.dueDate, mockupNow(), { terminal });
  const daysOver = overdue && item.dueDate ? daysBetween(item.dueDate, MOCKUP_TODAY) : 0;

  return (
    <article
      className={cn(
        'bg-card rounded-lg border p-3 shadow-xs transition-shadow hover:shadow-md',
        overdue && 'border-l-4 border-l-red-500',
        terminal && 'opacity-55'
      )}
    >
      <div className='flex items-start justify-between gap-2'>
        <h4 className={cn('text-sm leading-snug font-medium', terminal && 'line-through')}>
          {item.title}
        </h4>
        {item.riskFlag && !terminal && (
          <Icons.alertCircle
            className='mt-0.5 size-3.5 shrink-0 text-red-500'
            aria-label='At risk'
          />
        )}
      </div>

      {showProject && (
        <Badge variant='outline' className={cn('mt-2 text-[10px] font-normal', project.accent)}>
          {project.name}
        </Badge>
      )}

      <div className='mt-3 flex items-center justify-between gap-2'>
        <span className='flex items-center gap-1.5'>
          <OwnerAvatar name={item.owner} />
          <span className={cn('text-xs', !item.owner && 'text-muted-foreground italic')}>
            {item.owner ?? 'unassigned'}
          </span>
        </span>

        {!due.absent && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]',
              overdue && 'bg-red-500/15 font-semibold text-red-700 dark:text-red-300',
              due.dueToday && 'bg-amber-500/15 font-semibold text-amber-800 dark:text-amber-200',
              !overdue && !due.dueToday && 'text-muted-foreground'
            )}
          >
            <Icons.calendar className='size-3' />
            {due.label}
          </span>
        )}
      </div>

      {overdue && (
        <p className='mt-2 text-[11px] font-semibold tracking-wide text-red-600 uppercase dark:text-red-400'>
          {daysOver} {daysOver === 1 ? 'day' : 'days'} over
        </p>
      )}
    </article>
  );
}
