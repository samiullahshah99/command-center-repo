import { describe, expect, it } from 'vitest';
import {
  COMPLETION_TZ,
  COMPLETION_TZ_OFFSET_MINUTES,
  windowEndFor,
  windowStartFor
} from './completion-window';

/**
 * ⚠️ THE BOUNDARY TESTS ARE THE POINT OF THIS FILE.
 *
 * Design §7 ranks the window convention the HIGHEST-REGRET decision in the whole
 * engine: change it later and every historical window has to be re-derived. These
 * tests pin the decision (§3.3 Option B, `Asia/Karachi`) so a later "tidy-up" that
 * reaches for `startOfUtcDay()` fails loudly instead of silently re-filing months
 * of completions.
 */

describe('the timezone decision itself', () => {
  it('is the business timezone, not UTC', () => {
    expect(COMPLETION_TZ).toBe('Asia/Karachi');
    expect(COMPLETION_TZ_OFFSET_MINUTES).toBe(300);
  });

  /**
   * ⚠️ THE FIXED-OFFSET ASSUMPTION, PINNED. A fixed +05:00 is exact ONLY because
   * Pakistan has observed no DST since 2009. If COMPLETION_TZ is ever moved to a
   * DST-observing zone, this pairing breaks silently — every window wrong for half
   * the year, with no error. This test makes that a failure instead.
   */
  it('pairs the constant with the offset that is only valid for a no-DST zone', () => {
    const NO_DST_ZONES: Record<string, number> = { 'Asia/Karachi': 300 };
    expect(
      NO_DST_ZONES[COMPLETION_TZ],
      `${COMPLETION_TZ} is not a known no-DST zone — switch to Intl.DateTimeFormat ` +
        `instead of adjusting COMPLETION_TZ_OFFSET_MINUTES`
    ).toBe(COMPLETION_TZ_OFFSET_MINUTES);
  });
});

describe('daily window — the boundary cases named in the brief', () => {
  /** 23:59:59 Karachi on 12 Aug = 18:59:59Z on 12 Aug. */
  it('23:59:59+05 credits THAT day', () => {
    expect(windowStartFor('daily', new Date('2026-08-12T18:59:59Z'))).toBe('2026-08-12');
  });

  /** 00:00:01 Karachi on 13 Aug = 19:00:01Z on 12 Aug. */
  it('00:00:01+05 credits the NEXT day', () => {
    expect(windowStartFor('daily', new Date('2026-08-12T19:00:01Z'))).toBe('2026-08-13');
  });

  it('exactly 00:00:00+05 belongs to the new day, not the old one', () => {
    expect(windowStartFor('daily', new Date('2026-08-12T19:00:00Z'))).toBe('2026-08-13');
  });

  /**
   * ⚠️⚠️ THE CASE THAT MOTIVATED THE WHOLE DECISION.
   *
   * 03:00 PKT on 13 Aug is 22:00Z on 12 Aug. Under the UTC convention this credits
   * 12 Aug — the PREVIOUS day — so someone doing their standup every morning looks
   * permanently one day late. That is a correctness failure about people, not a
   * convention preference, and it is why dept-health's UTC rule was NOT reused.
   */
  it('03:00 PKT credits TODAY, not yesterday (the decision’s whole reason)', () => {
    const at0300Pkt = new Date('2026-08-12T22:00:00Z');

    expect(windowStartFor('daily', at0300Pkt)).toBe('2026-08-13');
    // What the rejected UTC convention would have said:
    expect(at0300Pkt.toISOString().slice(0, 10)).toBe('2026-08-12');
  });

  it('midday is unambiguous under either convention', () => {
    expect(windowStartFor('daily', new Date('2026-08-12T09:00:00Z'))).toBe('2026-08-12');
  });
});

describe('weekly window — ISO week, Monday, in Karachi time', () => {
  // 2026-08-12 is a Wednesday.
  it('a Wednesday credits that week’s Monday', () => {
    expect(windowStartFor('weekly', new Date('2026-08-12T09:00:00Z'))).toBe('2026-08-10');
  });

  it('Monday credits itself', () => {
    expect(windowStartFor('weekly', new Date('2026-08-10T09:00:00Z'))).toBe('2026-08-10');
  });

  /**
   * ⚠️ THE SUNDAY OFF-BY-ONE. `getUTCDay()` is 0 for Sunday, so a naive `dow - 1`
   * reaches FORWARD a day and files every Sunday completion into the next week.
   */
  it('Sunday belongs to the week that STARTED, not the one about to', () => {
    expect(windowStartFor('weekly', new Date('2026-08-16T09:00:00Z'))).toBe('2026-08-10');
  });

  /** Sunday 23:59:59 PKT is still that week; one second later is a new week. */
  it('rolls over at Karachi midnight between Sunday and Monday', () => {
    expect(windowStartFor('weekly', new Date('2026-08-16T18:59:59Z'))).toBe('2026-08-10');
    expect(windowStartFor('weekly', new Date('2026-08-16T19:00:00Z'))).toBe('2026-08-17');
  });
});

describe('monthly and quarterly', () => {
  it('monthly credits the first of the month', () => {
    expect(windowStartFor('monthly', new Date('2026-08-12T09:00:00Z'))).toBe('2026-08-01');
  });

  /** 1 Aug 00:30 PKT = 31 Jul 19:30Z — a month boundary that UTC would get wrong. */
  it('monthly respects the Karachi boundary at the turn of the month', () => {
    expect(windowStartFor('monthly', new Date('2026-07-31T19:30:00Z'))).toBe('2026-08-01');
  });

  it.each([
    ['2026-02-14', '2026-01-01'],
    ['2026-05-14', '2026-04-01'],
    ['2026-08-14', '2026-07-01'],
    ['2026-11-14', '2026-10-01']
  ])('quarterly: %s credits %s', (day, expected) => {
    expect(windowStartFor('quarterly', new Date(`${day}T09:00:00Z`))).toBe(expected);
  });
});

describe('biweekly — anchored on the task, not the epoch', () => {
  const anchor = new Date('2026-08-10T09:00:00Z'); // a Monday

  it('the anchor week and the week after share one window', () => {
    const w1 = windowStartFor('biweekly', new Date('2026-08-12T09:00:00Z'), anchor);
    const w2 = windowStartFor('biweekly', new Date('2026-08-19T09:00:00Z'), anchor);
    expect(w1).toBe('2026-08-10');
    expect(w2).toBe('2026-08-10');
  });

  it('the third week starts a new window', () => {
    expect(windowStartFor('biweekly', new Date('2026-08-24T09:00:00Z'), anchor)).toBe('2026-08-24');
  });

  /**
   * ⚠️ Two tasks created a week apart are on OPPOSITE phases, which is why the
   * anchor exists. A global origin would make "every other week" mean different
   * weeks for different tasks with no way to reason about it.
   */
  it('a task anchored a week later is on the opposite phase', () => {
    const later = new Date('2026-08-17T09:00:00Z');
    expect(windowStartFor('biweekly', new Date('2026-08-19T09:00:00Z'), later)).toBe('2026-08-17');
  });

  it('degrades to weekly rather than throwing when no anchor is supplied', () => {
    expect(windowStartFor('biweekly', new Date('2026-08-12T09:00:00Z'))).toBe('2026-08-10');
  });

  /** A backfilled event predating the anchor must not produce a nonsense window. */
  it('handles an event BEFORE the anchor (Math.floor, not %)', () => {
    const w = windowStartFor('biweekly', new Date('2026-07-29T09:00:00Z'), anchor);
    expect(w).toBe('2026-07-27');
  });
});

describe('windowEndFor — exclusive, and consistent with windowStartFor', () => {
  it('a daily window ends at the next Karachi midnight', () => {
    expect(windowEndFor('daily', '2026-08-12').toISOString()).toBe('2026-08-12T19:00:00.000Z');
  });

  it('a weekly window ends seven days later', () => {
    expect(windowEndFor('weekly', '2026-08-10').toISOString()).toBe('2026-08-16T19:00:00.000Z');
  });

  it('monthly and quarterly land on the next period’s first day', () => {
    expect(windowEndFor('monthly', '2026-08-01').toISOString()).toBe('2026-08-31T19:00:00.000Z');
    expect(windowEndFor('quarterly', '2026-07-01').toISOString()).toBe('2026-09-30T19:00:00.000Z');
  });

  /**
   * ⚠️ THE INVARIANT THAT TIES THE TWO FUNCTIONS TOGETHER. An instant one
   * millisecond before the end must still belong to the window; the end instant
   * itself must not. Without this they can drift apart and a completion falls in a
   * gap between two windows.
   */
  it.each(['daily', 'weekly', 'monthly', 'quarterly'] as const)(
    '%s: end-1ms is inside, end is outside',
    (cadence) => {
      const start = windowStartFor(cadence, new Date('2026-08-12T09:00:00Z'));
      const end = windowEndFor(cadence, start);

      expect(windowStartFor(cadence, new Date(end.getTime() - 1))).toBe(start);
      expect(windowStartFor(cadence, end)).not.toBe(start);
    }
  );
});
