import { MeetingCard } from '@/components/meeting-card';
import { SampleDataCaption } from '@/components/sample-data-caption';
import { Panel } from '@/components/ui/panel';
import type { ProfileMeetings } from '../api/types';

/**
 * Stacked meeting cards.
 *
 * ⚠️ EVERY VALUE HERE IS INVENTED. The transcripts are real and stored, but
 * "this person's meetings" cannot be queried — Fireflies webhooks carry a
 * `meeting_id` and no actor, so attribution is 0%. See `sampleMeetings()` in
 * ../api/service.ts, audit D4, and docs/gaps.md.
 *
 * ⚠️ The card itself lives in `@/components/meeting-card` — My day renders the same
 * one. Its header carries the "→ Tracker" relabel and the no-date-formatting rule.
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
          <MeetingCard key={m.id} meeting={m} />
        ))}
      </div>
    </div>
  );
}
