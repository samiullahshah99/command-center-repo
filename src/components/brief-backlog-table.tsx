import { LABEL_CAPS, Panel } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { BRIEF_STATE_META, type BriefRow } from '@/lib/brief-view';

/**
 * Brief backlog — BRIEF / PRODUCT / OWNER / AGE / STATUS.
 *
 * ⚠️ SHARED by the creative department panel and the Briefs & quota screen,
 * pixel-identical. Extracted here rather than cross-imported from a feature —
 * CLAUDE.md allows constants to cross a boundary but not behaviour, and a
 * component two features render is exactly the case for `src/components`.
 *
 * ⚠️ REAL DATA, with two documented absences the CALLER cannot fix:
 *   • PRODUCT is always "—" — Vision carries no product field (audit §3.1)
 *   • OWNER is "—" wherever the actor identity is unlinked, NEVER guessed
 * Both are shaped by `buildBriefBacklog`; this only lays them out.
 *
 * ⚠️ PRESENTATIONAL ONLY. No hooks, no fetching, no date formatting — `ageDays`
 * arrives computed against a `now` the caller resolved once.
 */
export function BriefBacklogTable({
  rows,
  title,
  meta = 'via Brief Tracker',
  emptyCopy = 'No briefs in flight.'
}: {
  rows: BriefRow[];
  title?: string;
  meta?: string;
  emptyCopy?: string;
}) {
  return (
    <Panel
      title={title ?? `Brief backlog · ${rows.length}`}
      meta={<span className='text-[11.5px]'>{meta}</span>}
    >
      {rows.length === 0 ? (
        <p className='text-muted-foreground text-[12.5px]'>{emptyCopy}</p>
      ) : (
        <div className='overflow-x-auto'>
          <div className='min-w-[520px]'>
            <div
              className={cn(
                LABEL_CAPS,
                'grid grid-cols-[1.6fr_0.7fr_0.9fr_0.5fr_0.8fr] gap-[10px] border-b pb-[7px]'
              )}
            >
              <span>Brief</span>
              <span>Product</span>
              <span>Owner</span>
              <span className='text-right'>Age</span>
              <span>Status</span>
            </div>

            {rows.map((b) => {
              const state = BRIEF_STATE_META[b.state];
              return (
                <div
                  key={b.id}
                  className='grid grid-cols-[1.6fr_0.7fr_0.9fr_0.5fr_0.8fr] gap-[10px] border-b py-[8px] text-[12.5px] last:border-b-0'
                >
                  <span className='min-w-0 truncate font-semibold'>{b.title}</span>
                  <span className='text-muted-foreground'>{b.product}</span>
                  <span className='text-muted-foreground min-w-0 truncate'>{b.owner}</span>
                  <span className='text-right tabular-nums'>{b.ageDays}d</span>
                  <span className={cn('font-semibold', state.tone)}>{state.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}
