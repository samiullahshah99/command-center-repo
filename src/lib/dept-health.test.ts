import { describe, expect, it } from 'vitest';
import {
  BLOCKED_BAD_COUNT,
  computeDeptHealth,
  OVERDUE_BAD_DAYS,
  type DeptHealthItem
} from './dept-health';

/**
 * Fixed `now`. ⚠️ Never `new Date()` — these tests exist to pin day boundaries,
 * and a moving clock is exactly what makes a boundary test lie.
 *
 * Mid-afternoon UTC on purpose: an item due "today" is stored at 00:00, so a
 * naive timestamp subtraction would already call it 15 hours overdue. If
 * computeDeptHealth ever regresses to instant arithmetic, the due-today case
 * below fails.
 */
const NOW = new Date('2026-08-06T15:30:00.000Z');

/** UTC midnight, n days before NOW. Mirrors how the seed writes due dates. */
function daysAgo(n: number): Date {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function daysFromNow(n: number): Date {
  return daysAgo(-n);
}

function item(over: Partial<DeptHealthItem> = {}): DeptHealthItem {
  return { status: 'open', dueDate: daysFromNow(7), riskFlag: false, ...over };
}

describe('computeDeptHealth', () => {
  describe('good', () => {
    it('is good with no items at all', () => {
      const r = computeDeptHealth([], NOW);
      expect(r.status).toBe('good');
      // Empty exactly when good — the card renders no reason lines.
      expect(r.reasons).toEqual([]);
    });

    it('is good when every item is in the future and untroubled', () => {
      const r = computeDeptHealth(
        [
          item({ dueDate: daysFromNow(1) }),
          item({ status: 'in_progress', dueDate: daysFromNow(8) }),
          item({ dueDate: daysFromNow(30) })
        ],
        NOW
      );
      expect(r.status).toBe('good');
      expect(r.reasons).toEqual([]);
    });

    it('treats a null due date as never overdue', () => {
      const r = computeDeptHealth([item({ dueDate: null })], NOW);
      expect(r.status).toBe('good');
    });

    it('ignores terminal items however overdue or blocked they were', () => {
      const r = computeDeptHealth(
        [
          item({ status: 'done', dueDate: daysAgo(90) }),
          item({ status: 'cancelled', dueDate: daysAgo(60), riskFlag: true })
        ],
        NOW
      );
      expect(r.status).toBe('good');
      expect(r.reasons).toEqual([]);
    });
  });

  describe('needs_attention', () => {
    it('fires on a single item overdue by one day', () => {
      const r = computeDeptHealth([item({ dueDate: daysAgo(1) })], NOW);
      expect(r.status).toBe('needs_attention');
      expect(r.reasons).toEqual(['1 item overdue, worst by 1 day']);
    });

    it('fires on an at-risk item that is neither overdue nor blocked', () => {
      const r = computeDeptHealth([item({ riskFlag: true })], NOW);
      expect(r.status).toBe('needs_attention');
      expect(r.reasons).toEqual(['1 item flagged at risk']);
    });

    it('reports every trigger that fired, not just the first', () => {
      const r = computeDeptHealth(
        [
          item({ dueDate: daysAgo(2) }),
          item({ status: 'blocked' }),
          item({ riskFlag: true }),
          item()
        ],
        NOW
      );
      expect(r.status).toBe('needs_attention');
      expect(r.reasons).toEqual([
        '1 item overdue, worst by 2 days',
        '1 blocked item',
        '1 item flagged at risk'
      ]);
    });
  });

  describe('bad', () => {
    it('fires when an item is overdue by more than the limit', () => {
      const r = computeDeptHealth([item({ dueDate: daysAgo(OVERDUE_BAD_DAYS + 1) })], NOW);
      expect(r.status).toBe('bad');
      expect(r.reasons).toEqual(['1 item overdue, worst by 4 days (over the 3-day limit)']);
    });

    it('fires on the blocked threshold', () => {
      const r = computeDeptHealth([item({ status: 'blocked' }), item({ status: 'blocked' })], NOW);
      expect(r.status).toBe('bad');
      expect(r.reasons).toEqual(['2 blocked items']);
    });

    it('reports both triggers when both fired', () => {
      const r = computeDeptHealth(
        [
          item({ dueDate: daysAgo(5) }),
          item({ status: 'blocked' }),
          item({ status: 'blocked' }),
          item({ riskFlag: true })
        ],
        NOW
      );
      expect(r.status).toBe('bad');
      expect(r.reasons).toEqual([
        '1 item overdue, worst by 5 days (over the 3-day limit)',
        '2 blocked items',
        '1 item flagged at risk'
      ]);
    });

    it('reports the WORST overdue item, not the first or the newest', () => {
      const r = computeDeptHealth(
        [
          item({ dueDate: daysAgo(1) }),
          item({ dueDate: daysAgo(9) }),
          item({ dueDate: daysAgo(4) })
        ],
        NOW
      );
      expect(r.status).toBe('bad');
      expect(r.reasons[0]).toBe('3 items overdue, worst by 9 days (over the 3-day limit)');
    });
  });

  // ── The boundaries the rule turns on ──────────────────────────────────────
  //
  // ⚠️ These are the assertions that make OVERDUE_BAD_DAYS / BLOCKED_BAD_COUNT
  // mean something. `>` vs `>=` and `>=` vs `>` read identically at a glance and
  // each is a whole state on the Control Tower.
  describe('boundary cases', () => {
    it('overdue by EXACTLY the limit is needs_attention, NOT bad', () => {
      const r = computeDeptHealth([item({ dueDate: daysAgo(OVERDUE_BAD_DAYS) })], NOW);
      expect(r.status).toBe('needs_attention');
      expect(r.reasons).toEqual(['1 item overdue, worst by 3 days']);
    });

    it('overdue by one day past the limit is bad', () => {
      const r = computeDeptHealth([item({ dueDate: daysAgo(OVERDUE_BAD_DAYS + 1) })], NOW);
      expect(r.status).toBe('bad');
    });

    it('EXACTLY one blocked item is needs_attention, NOT bad', () => {
      const r = computeDeptHealth([item({ status: 'blocked' })], NOW);
      expect(r.status).toBe('needs_attention');
      expect(r.reasons).toEqual(['1 blocked item']);
    });

    it('one more than the blocked threshold stays bad', () => {
      const blocked = Array.from({ length: BLOCKED_BAD_COUNT + 1 }, () =>
        item({ status: 'blocked' })
      );
      expect(computeDeptHealth(blocked, NOW).status).toBe('bad');
    });

    it('due TODAY is not overdue, even though `now` is mid-afternoon', () => {
      const r = computeDeptHealth([item({ dueDate: daysFromNow(0) })], NOW);
      expect(r.status).toBe('good');
      expect(r.reasons).toEqual([]);
    });

    it('due tomorrow is not overdue', () => {
      expect(computeDeptHealth([item({ dueDate: daysFromNow(1) })], NOW).status).toBe('good');
    });
  });

  describe('input tolerance', () => {
    it('accepts an ISO string due date, as a DTO would carry', () => {
      const r = computeDeptHealth([item({ dueDate: daysAgo(5).toISOString() })], NOW);
      expect(r.status).toBe('bad');
    });

    it('treats an unknown status as active rather than silently dropping it', () => {
      // A status added to TRACKED_ITEM_STATUSES but not to TERMINAL_STATUSES must
      // still be counted — failing open here would hide work.
      const r = computeDeptHealth([{ status: 'escalated', dueDate: daysAgo(10) }], NOW);
      expect(r.status).toBe('bad');
    });

    it('treats a missing riskFlag as not at risk', () => {
      const r = computeDeptHealth([{ status: 'open', dueDate: daysFromNow(3) }], NOW);
      expect(r.status).toBe('good');
    });
  });
});
