import { queryOptions } from '@tanstack/react-query';
import { getExtractionDetail, getExtractionStatus, getMeetings } from './service';
import type { ExtractionDetail, ExtractionStatusResponse, MeetingListResponse } from './types';

export type { ExtractionDetail, ExtractionStatusResponse, MeetingListResponse };

/**
 * Key factory. Server and client MUST build keys from these same functions —
 * a hand-written key on one side misses the hydration and the client silently
 * refetches, which shows up as a flash rather than an error.
 */
export const extractionKeys = {
  all: ['extraction'] as const,
  meetings: (limit: number) => [...extractionKeys.all, 'meetings', limit] as const,
  detail: (firefliesId: string) => [...extractionKeys.all, 'detail', firefliesId] as const,
  status: (firefliesId: string) => [...extractionKeys.all, 'status', firefliesId] as const
};

export const meetingsQueryOptions = (limit = 25) =>
  queryOptions({
    queryKey: extractionKeys.meetings(limit),
    queryFn: () => getMeetings(limit),
    // The list hits Fireflies live. Re-running it on every window focus would
    // spend the daily request budget on nothing — the data changes when a
    // meeting ends, not when someone alt-tabs.
    staleTime: 60_000
  });

export const extractionDetailOptions = (firefliesId: string) =>
  queryOptions({
    queryKey: extractionKeys.detail(firefliesId),
    queryFn: () => getExtractionDetail(firefliesId)
  });

/**
 * Poll target while an extraction is in flight.
 *
 * refetchInterval lives at the call site rather than here: this same query is
 * also read once, non-polling, to decide whether polling is needed at all.
 */
export const extractionStatusOptions = (firefliesId: string) =>
  queryOptions({
    queryKey: extractionKeys.status(firefliesId),
    queryFn: () => getExtractionStatus(firefliesId)
  });
