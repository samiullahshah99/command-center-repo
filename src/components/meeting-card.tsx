import { InsetBox, LABEL_CAPS, Panel, TagPill } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { ROW_TONE } from '@/lib/row-tone';
import { MEETING_ACTION_LABEL, MEETING_ACTION_TONE, type MeetingView } from '@/lib/meeting-view';

/**
 * One meeting: header, attendees, AI summary, action items.
 *
 * ⚠️ SHARED by the person profile's Meetings tab and My day's latest-meeting
 * card. Extracted here rather than cross-imported from a feature — CLAUDE.md
 * allows constants to cross a feature boundary but not behaviour, and a component
 * two features render is exactly the case for `src/components`.
 *
 * ⚠️ PRESENTATIONAL ONLY. No hooks, no fetching, no `isSample` handling — the
 * caller renders `<SampleDataCaption/>` above it when its data is invented,
 * because whether a meeting is real depends on where it came from, not on how it
 * looks.
 *
 * ⚠️ "ACTION ITEMS → TRACKER", not "→ ClickUp". The mockup says ClickUp; the
 * 2026-08-04 amendment made the Command Centre the task system of record and no
 * external task tool is written to. Rendering the mockup's label would advertise a
 * sync that does not exist and must never be built — and it is the kind of label a
 * reader treats as a promise about where their work went.
 *
 * ⚠️ NO DATE FORMATTING HERE. `when` arrives pre-formatted — see `MeetingView`.
 */
export function MeetingCard({ meeting, title }: { meeting: MeetingView; title?: string }) {
  return (
    <Panel title={title}>
      <div className='flex items-center gap-[8px]'>
        <h4 className='min-w-0 flex-1 truncate text-[14px] font-semibold'>{meeting.title}</h4>
        <TagPill>{meeting.tool}</TagPill>
        <span className='text-muted-foreground shrink-0 text-[12px]'>{meeting.when}</span>
      </div>

      {meeting.attendees.length > 0 && (
        <p className='text-muted-foreground text-[11.5px]'>{meeting.attendees.join(' · ')}</p>
      )}

      {/* Per-meeting AI summary. Distinct from the page-level AI summary card,
          which owns the two-gate cache and the double labelling. */}
      <div className='bg-muted rounded-[10px] p-[12px_14px]'>
        <div className={cn(LABEL_CAPS, 'mb-[5px]')}>AI summary</div>
        <p className='text-[13px] leading-[1.55]'>{meeting.aiSummary}</p>
      </div>

      {meeting.actions.length > 0 && (
        <div>
          <div className={cn(LABEL_CAPS, 'mb-[7px]')}>Action items → Tracker</div>
          <InsetBox className='divide-y p-0'>
            {meeting.actions.map((a) => {
              const tone = MEETING_ACTION_TONE[a.state];
              return (
                <div key={a.id} className='flex items-center gap-[10px] px-[12px] py-[8px]'>
                  <span
                    className={cn('size-[8px] shrink-0 rounded-full', ROW_TONE[tone].dot)}
                    aria-hidden
                  />
                  <span className='min-w-0 flex-1 truncate text-[12.5px]'>{a.text}</span>
                  <span className='text-muted-foreground shrink-0 text-[11.5px]'>
                    {a.ownerName}
                  </span>
                  <span
                    className={cn(
                      'w-[74px] shrink-0 text-right text-[11.5px] font-semibold',
                      ROW_TONE[tone].text
                    )}
                  >
                    {MEETING_ACTION_LABEL[a.state]}
                  </span>
                </div>
              );
            })}
          </InsetBox>
        </div>
      )}
    </Panel>
  );
}
