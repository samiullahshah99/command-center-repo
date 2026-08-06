import { queryOptions } from '@tanstack/react-query';
import { getAutomations } from './service';
import type { Automations } from './types';

export type { Automations };

export const automationsKeys = {
  all: ['automations'] as const,
  /**
   * Keyed on the UTC DAY, not the raw instant — keying on `now` would mint a new
   * entry per render and the client's key would never match the server's
   * prefetched one, which presents as a flash. Same pattern as My day.
   */
  overview: (dayKey: string) => [...automationsKeys.all, dayKey] as const
};

/** ⚠️ Takes an ISO STRING so both sides of the SSR handoff build the same key. */
export const automationsQueryOptions = (nowIso: string) =>
  queryOptions({
    queryKey: automationsKeys.overview(nowIso.slice(0, 10)),
    queryFn: () => getAutomations(new Date(nowIso))
  });
