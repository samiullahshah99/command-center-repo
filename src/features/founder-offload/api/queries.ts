import { queryOptions } from '@tanstack/react-query';
import { getFounderOffload } from './service';

export const founderOffloadKeys = {
  all: ['founder-offload'] as const,
  board: () => [...founderOffloadKeys.all, 'board'] as const
};

/**
 * ⚠️ NO `now` AND NO FILTERS IN THE KEY — the screen is static sample data with
 * no time-dependent field, so the key is a constant and both sides of the SSR
 * handoff build it identically without having to agree on an instant. Same
 * precedent as People & org's `peopleOrgQueryOptions`.
 */
export const founderOffloadQueryOptions = () =>
  queryOptions({
    queryKey: founderOffloadKeys.board(),
    queryFn: () => getFounderOffload()
  });
