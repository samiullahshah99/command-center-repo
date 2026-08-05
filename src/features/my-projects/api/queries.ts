import { queryOptions } from '@tanstack/react-query';
import { getMyProjects } from './service';
import type { MyProjects } from './types';

export type { MyProjects };

export const myProjectsKeys = {
  all: ['my-projects'] as const,
  /**
   * Keyed on the person and the UTC DAY, not the raw instant — keying on `now`
   * would mint a new entry per render and the client's key would never match the
   * server's prefetched one, which presents as a flash. Same pattern as My day.
   */
  mine: (personId: string, dayKey: string) => [...myProjectsKeys.all, personId, dayKey] as const
};

/** ⚠️ Takes an ISO STRING so both sides of the SSR handoff build the same key. */
export const myProjectsQueryOptions = (personId: string, nowIso: string) =>
  queryOptions({
    queryKey: myProjectsKeys.mine(personId, nowIso.slice(0, 10)),
    queryFn: () => getMyProjects(personId, new Date(nowIso))
  });
