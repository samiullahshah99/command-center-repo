import { queryOptions } from '@tanstack/react-query';
import { getCaptureQueue, getExtractionDetail, getExtractionStatus, getMeetings } from './service';
import type {
  CaptureQueue,
  ExtractionDetail,
  ExtractionStatusResponse,
  MeetingListResponse
} from './types';

export type { CaptureQueue, ExtractionDetail, ExtractionStatusResponse, MeetingListResponse };

/**
 * Key factory. Server and client MUST build keys from these same functions —
 * a hand-written key on one side misses the hydration and the client silently
 * refetches, which shows up as a flash rather than an error.
 */
export const extractionKeys = {
  all: ['extraction'] as const,
  meetings: (limit: number) => [...extractionKeys.all, 'meetings', limit] as const,
  /**
   * The capture queue. Nested under `all`, so the review mutations' existing
   * `invalidateQueries({ queryKey: extractionKeys.all })` refreshes this page
   * after an approve or dismiss with NO change to those mutations.
   */
  captureQueue: () => [...extractionKeys.all, 'capture-queue'] as const,
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

/**
 * The Capture queue rollup.
 *
 * ⚠️ No `staleTime`. Unlike the meetings list, this touches nothing upstream — it
 * is four local aggregates — and it is the surface a reviewer is actively working,
 * so a stale queue after an approve would be the one thing it must not do. The
 * review mutations already invalidate `extractionKeys.all`, which covers this.
 */
export const captureQueueOptions = () =>
  queryOptions({
    queryKey: extractionKeys.captureQueue(),
    queryFn: () => getCaptureQueue()
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
