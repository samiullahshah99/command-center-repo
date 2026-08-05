import { queryOptions } from '@tanstack/react-query';
import { getMyDay } from './service';
import type { MyDay } from './types';

export type { MyDay };

export const myDayKeys = {
  all: ['my-day'] as const,
  /**
   * Keyed on the person and the UTC DAY, not on the raw instant.
   *
   * ⚠️ Keying on `now` itself would mint a new entry on every render, so the
   * client's key would never match the server's prefetched one — hydration misses
   * and the page refetches with a visible flash. The UTC day is the granularity
   * every comparison in this feature actually uses.
   */
  day: (personId: string, dayKey: string) => [...myDayKeys.all, personId, dayKey] as const
};

/**
 * ⚠️ TAKES AN ISO STRING, NOT A `Date`, and that is the point.
 *
 * `now` is resolved ONCE in the page (a server component) and threaded to both
 * sides of the SSR handoff: the server prefetches with it, and the client body
 * rebuilds the same options from the same string. Two `new Date()` calls — one per
 * side — would produce two different instants and therefore two different keys,
 * which is exactly the hydration miss CLAUDE.md warns about. A string is
 * serialisable, comparable, and cannot drift between the two calls.
 */
export const myDayQueryOptions = (personId: string, nowIso: string) =>
  queryOptions({
    queryKey: myDayKeys.day(personId, nowIso.slice(0, 10)),
    queryFn: () => getMyDay(personId, new Date(nowIso))
  });
