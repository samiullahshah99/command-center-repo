import { cn } from '@/lib/utils';
import { MOCKUP_TODAY } from '../../constants';
import { isOverdue, type MockItem } from '../../fixtures';
import { KanbanCard } from './kanban-card';

/**
 * A column, with its WIP count in the header.
 *
 * ⚠️ Empty columns are RENDERED, not hidden. A kanban is a set of fixed lanes;
 * one that vanishes when it empties changes the board's shape under the reader
 * and removes the slot they were looking for. Same rule as the shipped board.
 */
export function KanbanColumn({
  title,
  dot,
  items,
  showProject = true,
  /** Soft WIP limit — exceeded columns get a subtle warning, as Monday does. */
  wipLimit
}: {
  title: string;
  dot: string;
  items: MockItem[];
  showProject?: boolean;
  wipLimit?: number;
}) {
  const overdueCount = items.filter((i) => isOverdue(i, MOCKUP_TODAY)).length;
  const overLimit = wipLimit !== undefined && items.length > wipLimit;

  return (
    <section className='bg-muted/40 flex w-[280px] shrink-0 flex-col rounded-xl border'>
      <header className='flex items-center gap-2 border-b px-3 py-2.5'>
        <span className={cn('size-2.5 shrink-0 rounded-full', dot)} />
        <h3 className='truncate text-sm font-semibold'>{title}</h3>

        <span
          className={cn(
            'ml-auto rounded-md px-1.5 py-0.5 font-mono text-xs',
            overLimit
              ? 'bg-amber-500/20 font-semibold text-amber-800 dark:text-amber-200'
              : 'text-muted-foreground bg-background'
          )}
          title={wipLimit === undefined ? undefined : `WIP limit ${wipLimit}`}
        >
          {items.length}
          {wipLimit !== undefined && <span className='opacity-60'>/{wipLimit}</span>}
        </span>
      </header>

      {overdueCount > 0 && (
        <p className='border-b border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[11px] font-medium text-red-700 dark:text-red-300'>
          {overdueCount} overdue
        </p>
      )}

      <div className='flex flex-col gap-2 p-2'>
        {items.length === 0 ? (
          <p className='text-muted-foreground/70 px-1 py-6 text-center text-xs'>Nothing here</p>
        ) : (
          items.map((i) => <KanbanCard key={i.id} item={i} showProject={showProject} />)
        )}
      </div>
    </section>
  );
}
