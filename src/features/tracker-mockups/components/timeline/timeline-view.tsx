import { Badge } from '@/components/ui/badge';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { formatDateOnly } from '@/lib/format-date';
import { MOCKUP_TODAY, TIMELINE_WEEK_COUNT, gridPercent, timelineStart } from '../../constants';
import { ITEMS, PROJECTS, isOverdue, isTerminalStatus, type MockItem } from '../../fixtures';
import { OwnerAvatar } from '../owner-avatar';
import { TimelineBar } from './timeline-bar';

/** Monday of each grid column. */
function weekColumns(): string[] {
  const out: string[] = [];
  const d = new Date(`${timelineStart()}T00:00:00Z`);
  for (let i = 0; i < TIMELINE_WEEK_COUNT; i += 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

/**
 * Roadmap: projects as horizontal bands over a week grid.
 *
 * Rows are one-item-per-row rather than packed. Packing bars onto shared rows
 * saves vertical space and costs the thing the view is for — you can no longer
 * follow a single item across the grid, and two bars on one row read as one
 * piece of work with a gap in it.
 */
export function TimelineView() {
  const weeks = weekColumns();
  const todayLeft = gridPercent(MOCKUP_TODAY);

  return (
    <div className='flex flex-col gap-6'>
      <Legend />

      <div className='overflow-hidden rounded-xl border'>
        {/* Week header */}
        <div className='bg-muted/50 flex border-b'>
          <div className='w-[220px] shrink-0 border-r px-3 py-2'>
            <span className='text-muted-foreground text-[11px] tracking-wide uppercase'>
              Project
            </span>
          </div>
          <div className='relative flex-1'>
            <div className='flex h-full'>
              {weeks.map((w) => (
                <div
                  key={w}
                  className='flex-1 border-r px-2 py-2 text-center last:border-r-0'
                  style={{ width: `${100 / TIMELINE_WEEK_COUNT}%` }}
                >
                  <span className='text-muted-foreground text-[10px] whitespace-nowrap'>
                    {formatDateOnly(w).replace(/ \d{4}$/, '')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {PROJECTS.map((project) => {
          const dated = ITEMS.filter((i) => i.projectId === project.id && i.dueDate !== null);
          if (dated.length === 0) return null;

          return (
            <div key={project.id} className='flex border-b last:border-b-0'>
              <div className='bg-muted/20 w-[220px] shrink-0 border-r px-3 py-3'>
                <span className='flex items-center gap-2'>
                  <span className={cn('size-2.5 shrink-0 rounded-full', project.dot)} />
                  <span className='text-sm font-medium'>{project.name}</span>
                </span>
                <span className='text-muted-foreground mt-1 block text-[11px]'>
                  {dated.length} scheduled ·{' '}
                  {dated.filter((i) => isOverdue(i, MOCKUP_TODAY)).length} late
                </span>
              </div>

              <div className='relative flex-1 py-2'>
                <GridLines weeks={weeks} />
                <TodayLine left={todayLeft} />

                <div className='relative flex flex-col gap-1.5'>
                  {dated
                    .toSorted((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
                    .map((item) => (
                      <div key={item.id} className='relative h-7'>
                        <TimelineBar item={item} />
                      </div>
                    ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ParkedRow items={ITEMS.filter((i) => i.dueDate === null)} />
    </div>
  );
}

function GridLines({ weeks }: { weeks: string[] }) {
  return (
    <div className='pointer-events-none absolute inset-0 flex'>
      {weeks.map((w) => (
        <div
          key={w}
          className='border-border/60 border-r last:border-r-0'
          style={{ width: `${100 / weeks.length}%` }}
        />
      ))}
    </div>
  );
}

/** The today marker — the reference every overdue bar is measured against. */
function TodayLine({ left }: { left: number }) {
  return (
    <div
      className='pointer-events-none absolute inset-y-0 z-10 w-px bg-red-500'
      style={{ left: `${left}%` }}
    >
      <span className='absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-red-500' />
    </div>
  );
}

/**
 * Undated work, parked below the grid.
 *
 * ⚠️ Shown, not dropped. An item with no due date cannot be placed on a
 * time axis, but silently omitting it makes the roadmap look complete when it
 * is not — and undated work is usually the work nobody has committed to.
 */
function ParkedRow({ items }: { items: MockItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className='border-muted-foreground/30 rounded-xl border border-dashed p-4'>
      <header className='mb-3 flex items-center gap-2'>
        <Icons.clock className='text-muted-foreground size-4' />
        <h3 className='text-sm font-semibold'>Parked — no due date</h3>
        <span className='text-muted-foreground bg-muted rounded-md px-1.5 py-0.5 font-mono text-[11px]'>
          {items.length}
        </span>
        <span className='text-muted-foreground/70 text-xs'>
          — cannot be placed on the grid until someone commits to a date
        </span>
      </header>

      <div className='flex flex-wrap gap-2'>
        {items.map((i) => (
          <span
            key={i.id}
            className={cn(
              'bg-card flex items-center gap-2 rounded-lg border px-2.5 py-1.5',
              isTerminalStatus(i.status) && 'opacity-55'
            )}
          >
            <OwnerAvatar name={i.owner} />
            <span className='text-xs'>{i.title}</span>
            <Badge variant='outline' className='text-[10px] font-normal'>
              {i.owner ?? 'unassigned'}
            </Badge>
          </span>
        ))}
      </div>
    </section>
  );
}

function Legend() {
  return (
    <div className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]'>
      <span className='flex items-center gap-1.5'>
        <span className='h-3 w-px bg-red-500' />
        today ({formatDateOnly(MOCKUP_TODAY)})
      </span>
      <span className='flex items-center gap-1.5'>
        <span className='h-2.5 w-6 rounded-sm border border-red-500/60 bg-red-500/20' />
        overdue — bar runs past its due date to the line
      </span>
      <span className='flex items-center gap-1.5'>
        <span className='border-muted-foreground/50 h-2.5 w-6 rounded-sm border border-dashed' />
        blocked
      </span>
    </div>
  );
}
