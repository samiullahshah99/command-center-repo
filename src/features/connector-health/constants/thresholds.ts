import { RAW_EVENT_SOURCES, type RawEventSource } from '@/db/schema/raw-event';

/**
 * Per-source freshness thresholds.
 *
 * ⚠️ ONE GLOBAL NUMBER WOULD BE WRONG IN BOTH DIRECTIONS, which is why this file
 * exists. Vision emits tens of events a day, so a day of silence is a real
 * signal. ClickUp emitted 2 events in the whole dataset and can legitimately be
 * quiet for a fortnight — holding it to Vision's bar would paint it permanently
 * red and train everyone to ignore the colour, which costs more than having no
 * indicator at all.
 *
 * Values below were chosen from MEASURED cadence, not guessed:
 *
 *   source     events   newest observed      chosen
 *   vision       184    same day             24h
 *   ugc           91    same day             24h
 *   slack         11    4 days ago           72h
 *   fireflies     10    1 day ago            168h (7d)
 *   clickup        2    4 days ago           336h (14d)
 *
 * ⚠️ STALENESS IS NOT AN ERROR, and it deliberately does NOT use red. Red is
 * reserved for jobs in failed/dead-letter — something that actually broke and
 * has a fix. A quiet source may just be a quiet week, so it reads as a caption,
 * not an alarm. Mixing the two would make a genuine failure indistinguishable
 * from a slow Tuesday.
 *
 * ⚠️ These are thresholds on "last event RECEIVED", which is a PROXY for webhook
 * health and not a measurement of it. See the caption in the UI: no provider
 * exposes "is my subscription still alive?", so a silent source and a broken
 * subscription look identical from here. Raise the threshold rather than
 * inventing a health signal that does not exist.
 */
export const STALE_AFTER_HOURS: Record<RawEventSource, number> = {
  vision: 24,
  ugc: 24,
  slack: 72,
  fireflies: 168,
  clickup: 336
};

/** Display labels. The DB stores lowercase source keys. */
export const SOURCE_LABEL: Record<RawEventSource, string> = {
  slack: 'Slack',
  clickup: 'ClickUp',
  vision: 'Vision',
  ugc: 'UGC',
  fireflies: 'Fireflies'
};

/**
 * What each connector's cadence actually depends on — shown under the freshness
 * line so "quiet" can be judged rather than just noted.
 */
export const CADENCE_NOTE: Record<RawEventSource, string> = {
  vision: 'Expect many per day while editors are working.',
  ugc: 'Expect many per day while creators are active.',
  slack: 'Only channels the bot has been invited to emit events.',
  fireflies: 'One burst per meeting — quiet between meetings is normal.',
  clickup: 'Low volume by design; ClickUp is a transitional read-only source.'
};

export { RAW_EVENT_SOURCES };
export type { RawEventSource };
