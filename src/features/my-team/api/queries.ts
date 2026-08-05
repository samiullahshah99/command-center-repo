import { queryOptions } from '@tanstack/react-query';
import { getMyTeam } from './service';
import type { MyTeam } from './types';

export type { MyTeam };

export const myTeamKeys = {
  all: ['my-team'] as const,
  /**
   * Keyed on the department and the UTC DAY, not the raw instant.
   *
   * ⚠️ Keying on `now` itself would mint a new entry per render, so the client's
   * key would never match the server's prefetched one — hydration misses and the
   * page refetches with a visible flash. The UTC day is the granularity every
   * comparison here uses.
   */
  team: (departmentId: string, dayKey: string) => [...myTeamKeys.all, departmentId, dayKey] as const
};

/**
 * ⚠️ TAKES AN ISO STRING, NOT A `Date`. `now` is resolved once in the page and
 * threaded to both sides of the SSR handoff, so the two build the same key. Two
 * `new Date()` calls — one per side — would produce two different instants and
 * therefore two different keys. Same reasoning as `myDayQueryOptions`.
 */
export const myTeamQueryOptions = (departmentId: string, nowIso: string) =>
  queryOptions({
    queryKey: myTeamKeys.team(departmentId, nowIso.slice(0, 10)),
    queryFn: () => getMyTeam(departmentId, new Date(nowIso))
  });
