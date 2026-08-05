import { InsetBox, LABEL_CAPS, Panel, TagPill } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import type { ProfileMeetings } from '../api/types';
import { MEETING_ACTION_LABEL, MEETING_ACTION_TONE, ROW_TONE } from '../constants/profile-options';
import { SampleDataCaption } from './profile-tabs';

/**
 * Stacked meeting cards: header, attendees, AI summary, action items.
 *
 * ⚠️ EVERY VALUE HERE IS INVENTED. The transcripts are real and stored, but
 * "this person's meetings" cannot be queried — Fireflies webhooks carry a
 * `meeting_id` and no actor, so attribution is 0%. See `sampleMeetings()` in
 * ../api/service.ts, audit D4, and docs/gaps.md.
 *
 * ⚠️ "ACTION ITEMS → TRACKER", not "→ ClickUp". The mockup says ClickUp; the
 * 2026-08-04 amendment made the Command Centre the task system of record and no
 * external task tool is written to. Rendering the mockup's label would advertise
 * a sync that does not exist and must never be built — and it is the kind of
 * label a reader treats as a promise about where their work went.
 *
 * ⚠️ `when` arrives pre-formatted from the service. No date formatting here.
 */
export function MeetingsTab({ meetings }: { meetings: ProfileMeetings }) {
  if (meetings.items.length === 0) {
    return (
      <Panel>
        <p className='text-muted-foreground py-8 text-center text-sm'>No meetings recorded.</p>
      </Panel>
    );
  }

  return (
    <div>
      {meetings.isSample && (
        <SampleDataCaption what='Fireflies attribution is not built, so these meetings are illustrative.' />
      )}

      <div className='flex flex-col gap-[12px]'>
        {meetings.items.map((m) => (
          <Panel key={m.id}>
            <div className='flex items-center gap-[8px]'>
              <h4 className='min-w-0 flex-1 truncate text-[14px] font-semibold'>{m.title}</h4>
              <TagPill>{m.tool}</TagPill>
              <span className='text-muted-foreground shrink-0 text-[12px]'>{m.when}</span>
            </div>

            <p className='text-muted-foreground text-[11.5px]'>{m.attendees.join(' · ')}</p>

            {/* AI summary block. The page's own AI summary card carries the
                two-gate cache and the double labelling; this is a per-meeting
                summary and is part of the sample payload. */}
            <div className='bg-muted rounded-[10px] p-[12px_14px]'>
              <div className={cn(LABEL_CAPS, 'mb-[5px]')}>AI summary</div>
              <p className='text-[13px] leading-[1.55]'>{m.aiSummary}</p>
            </div>

            {m.actions.length > 0 && (
              <div>
                <div className={cn(LABEL_CAPS, 'mb-[7px]')}>Action items → Tracker</div>
                <InsetBox className='divide-y p-0'>
                  {m.actions.map((a) => {
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
        ))}
      </div>
    </div>
  );
}
