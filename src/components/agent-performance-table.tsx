import { SampleDataCaption } from '@/components/sample-data-caption';
import { LABEL_CAPS, Panel } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { AGENT_CADENCE_META, type AgentPerformanceView } from '@/lib/agent-performance';

/**
 * Agent performance — AGENT / TICKETS / RESOLVED / CSAT / CADENCE.
 *
 * ⚠️ SHARED by `/dashboard/my-team` and the CX department panel, pixel-identical.
 * Extracted here rather than cross-imported from a feature — CLAUDE.md allows
 * constants to cross a boundary but not behaviour, and a component two features
 * render is exactly the case for `src/components`.
 *
 * ⚠️ HYBRID DATA. The AGENT column is real; every FIGURE is invented because
 * Zendesk has no code at all (audit §3.3). This component does not decide that —
 * it renders the caption from the data's own `figuresAreSample` flag, so a caller
 * cannot show the numbers without the label.
 *
 * ⚠️ PRESENTATIONAL ONLY. No hooks, no fetching. Each feature's service builds the
 * rows; this only lays them out.
 */
export function AgentPerformanceTable({
  data,
  emptyCopy = 'No members in this team yet.'
}: {
  data: AgentPerformanceView;
  emptyCopy?: string;
}) {
  return (
    <Panel
      title='Agent performance'
      meta={<span className='text-[11.5px]'>via Zendesk · this week</span>}
    >
      {data.figuresAreSample && (
        <SampleDataCaption what='performance figures are sample — Zendesk integration pending. The agents listed are real team members.' />
      )}

      {data.rows.length === 0 ? (
        <p className='text-muted-foreground text-[12.5px]'>{emptyCopy}</p>
      ) : (
        <div className='overflow-x-auto'>
          <div className='min-w-[560px]'>
            <div
              className={cn(
                LABEL_CAPS,
                'grid grid-cols-[1.2fr_0.7fr_0.7fr_0.7fr_0.9fr] gap-[10px] border-b pb-[7px]'
              )}
            >
              <span>Agent</span>
              <span className='text-right'>Tickets</span>
              <span className='text-right'>Resolved</span>
              <span className='text-right'>CSAT</span>
              <span>Cadence</span>
            </div>

            {data.rows.map((a) => (
              <div
                key={a.personId}
                className='grid grid-cols-[1.2fr_0.7fr_0.7fr_0.7fr_0.9fr] gap-[10px] border-b py-[8px] text-[12.5px] last:border-b-0'
              >
                <span className='min-w-0 truncate font-semibold'>{a.name}</span>
                <span className='text-right tabular-nums'>{a.tickets}</span>
                <span className='text-right tabular-nums'>{a.resolved}</span>
                <span className='text-right tabular-nums'>{a.csat.toFixed(1)}</span>
                <span className={cn('font-semibold', AGENT_CADENCE_META[a.cadence].tone)}>
                  {AGENT_CADENCE_META[a.cadence].label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
