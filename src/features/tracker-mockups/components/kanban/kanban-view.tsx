'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Icons } from '@/components/icons';
// Read-only import of the SHIPPED board's style tokens. Constants only — no
// service, query or mutation import — so the mockups look like the same product
// and cannot drift into a different visual language during the review.
import { STATUS_META } from '@/features/tracker/constants/tracker-options';
import { TRACKED_ITEM_STATUSES } from '@/db/schema/tracked-item';
import { MOCKUP_TODAY } from '../../constants';
import { ITEMS, PEOPLE, isOverdue, isTerminalStatus } from '../../fixtures';
import { KanbanColumn } from './kanban-column';

/**
 * Soft WIP limits per lane.
 *
 * Mockup values chosen so one lane visibly exceeds its limit — a WIP limit that
 * is never breached demonstrates nothing, and the amber count is the feature
 * being shown.
 */
const WIP_LIMITS: Partial<Record<(typeof TRACKED_ITEM_STATUSES)[number], number>> = {
  open: 8,
  in_progress: 4,
  blocked: 2
};

/**
 * The two grouping states.
 *
 * ⚠️ BOTH PANELS ARE PRE-RENDERED and the Tabs only show/hide them. There is no
 * grouping logic, no fetch, no state beyond which panel is visible — the point
 * is to put the swimlane concept in a screenshot, not to build the feature.
 */
export function KanbanView() {
  return (
    <Tabs defaultValue='status' className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <TabsList>
          <TabsTrigger value='status'>
            <Icons.dashboard className='mr-1.5 size-3.5' />
            Group by status
          </TabsTrigger>
          <TabsTrigger value='person'>
            <Icons.teams className='mr-1.5 size-3.5' />
            Swimlanes by person
          </TabsTrigger>
        </TabsList>

        <Legend />
      </div>

      <TabsContent value='status'>
        <ScrollArea className='w-full'>
          <div className='flex items-start gap-3 pb-4'>
            {TRACKED_ITEM_STATUSES.map((status) => (
              <KanbanColumn
                key={status}
                title={STATUS_META[status].label}
                dot={STATUS_META[status].dot}
                items={ITEMS.filter((i) => i.status === status)}
                wipLimit={WIP_LIMITS[status]}
              />
            ))}
          </div>
          <ScrollBar orientation='horizontal' />
        </ScrollArea>
      </TabsContent>

      <TabsContent value='person'>
        {/*
          Swimlanes: one horizontal band per person, each band a miniature board
          of that person's live work. Terminal items are dropped here — a
          per-person lane is a workload view, and finished work is not workload.
        */}
        <div className='flex flex-col gap-6'>
          {PEOPLE.map((p) => {
            const mine = ITEMS.filter((i) => i.owner === p.name && !isTerminalStatus(i.status));
            const overdue = mine.filter((i) => isOverdue(i, MOCKUP_TODAY)).length;

            return (
              <section key={p.name}>
                <header className='mb-2 flex items-center gap-2'>
                  <h3 className='text-sm font-semibold'>{p.name}</h3>
                  <span className='text-muted-foreground text-xs'>{p.role}</span>
                  <span className='text-muted-foreground bg-muted ml-1 rounded-md px-1.5 py-0.5 font-mono text-[11px]'>
                    {mine.length}
                  </span>
                  {overdue > 0 && (
                    <span className='rounded-md bg-red-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300'>
                      {overdue} overdue
                    </span>
                  )}
                </header>

                <ScrollArea className='w-full'>
                  <div className='flex items-start gap-3 pb-3'>
                    {(['open', 'in_progress', 'blocked'] as const).map((status) => (
                      <KanbanColumn
                        key={status}
                        title={STATUS_META[status].label}
                        dot={STATUS_META[status].dot}
                        items={mine.filter((i) => i.status === status)}
                      />
                    ))}
                  </div>
                  <ScrollBar orientation='horizontal' />
                </ScrollArea>
              </section>
            );
          })}

          <UnassignedLane />
        </div>
      </TabsContent>
    </Tabs>
  );
}

/** Unassigned work gets its own lane rather than disappearing from the person view. */
function UnassignedLane() {
  const orphans = ITEMS.filter((i) => i.owner === null && !isTerminalStatus(i.status));
  if (orphans.length === 0) return null;

  return (
    <section className='border-muted-foreground/30 rounded-xl border border-dashed p-3'>
      <header className='mb-2 flex items-center gap-2'>
        <h3 className='text-muted-foreground text-sm font-semibold'>Unassigned</h3>
        <span className='text-muted-foreground bg-muted rounded-md px-1.5 py-0.5 font-mono text-[11px]'>
          {orphans.length}
        </span>
        <span className='text-muted-foreground/70 text-xs'>
          — nobody owns these, so they appear in no swimlane
        </span>
      </header>
      <div className='flex items-start gap-3'>
        <KanbanColumn title='Open' dot={STATUS_META.open.dot} items={orphans} />
      </div>
    </section>
  );
}

function Legend() {
  return (
    <div className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]'>
      <span className='flex items-center gap-1.5'>
        <span className='h-3 w-1 rounded-sm bg-red-500' />
        overdue
      </span>
      <span className='flex items-center gap-1.5'>
        <Icons.alertCircle className='size-3 text-red-500' />
        at risk
      </span>
      <span className='flex items-center gap-1.5'>
        <span className='rounded bg-amber-500/20 px-1 font-mono text-amber-800 dark:text-amber-200'>
          n/m
        </span>
        over WIP limit
      </span>
    </div>
  );
}
