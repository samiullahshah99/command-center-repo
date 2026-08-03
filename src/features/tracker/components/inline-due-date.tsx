'use client';

import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { formatDueDate } from '@/lib/format-date';
import { updateDueDateMutation } from '../api/mutations';

/** `Date` → `yyyy-mm-dd` in UTC. Never via toISOString on a local-midnight date. */
function toIsoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function InlineDueDate({
  itemId,
  projectId,
  value,
  terminal,
  now
}: {
  itemId: string;
  projectId: string;
  value: string | null;
  terminal: boolean;
  /**
   * ⚠️ Passed in, never `new Date()` here.
   *
   * "Overdue" compares against the current time, and the server clock and the
   * browser clock are never the same instant — computing it during render is the
   * Date.now() hydration bug in CLAUDE.md's "Known violations". Resolved once,
   * above the tree, so server and client agree.
   */
  now: Date;
}) {
  const m = useMutation(updateDueDateMutation(projectId));
  const view = formatDueDate(value, now, { terminal });

  return (
    <Popover>
      {/* base-ui, not Radix: the trigger takes `render`, not `asChild`.
          Matches src/components/ui/table/data-table-date-filter.tsx. */}
      <PopoverTrigger
        disabled={m.isPending}
        render={
          <Button
            variant='ghost'
            size='sm'
            className={cn(
              'h-8 justify-start px-2 font-normal',
              view.absent && 'text-muted-foreground italic',
              // Overdue is the one thing on this row that should catch the eye.
              view.overdue && 'font-medium text-red-600 dark:text-red-400',
              view.dueToday && 'font-medium text-amber-700 dark:text-amber-300'
            )}
          />
        }
      >
        <Icons.calendar className='mr-1.5 size-3.5' />
        {view.label}
        {view.overdue && <span className='ml-1.5 text-[11px] uppercase'>overdue</span>}
        {view.dueToday && <span className='ml-1.5 text-[11px] uppercase'>today</span>}
      </PopoverTrigger>

      <PopoverContent className='w-auto p-0' align='start'>
        <Calendar
          mode='single'
          selected={value ? new Date(value) : undefined}
          onSelect={(d) => m.mutate({ itemId, dueDate: d ? toIsoDay(d) : null })}
          initialFocus
        />
        <div className='border-t p-2'>
          <Button
            variant='ghost'
            size='sm'
            className='w-full'
            onClick={() => m.mutate({ itemId, dueDate: null })}
          >
            Clear date
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
