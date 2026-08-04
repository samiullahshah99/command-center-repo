import { queryOptions } from '@tanstack/react-query';
import { getBriefBoard, getBriefQuota, getBriefTimeline } from './service';

export const briefKeys = {
  all: ['briefs'] as const,
  board: () => [...briefKeys.all, 'board'] as const,
  timeline: (id: string) => [...briefKeys.all, 'timeline', id] as const,
  quota: () => [...briefKeys.all, 'quota'] as const
};

export const briefBoardQueryOptions = () =>
  queryOptions({ queryKey: briefKeys.board(), queryFn: () => getBriefBoard() });

/** Loaded on panel open, never with the board — see BriefDetailPanel. */
export const briefTimelineOptions = (id: string) =>
  queryOptions({ queryKey: briefKeys.timeline(id), queryFn: () => getBriefTimeline(id) });

/**
 * Shared by every People row through one TanStack cache entry, so N rows are
 * still ONE request. Do not call getBriefQuota per row.
 */
export const briefQuotaQueryOptions = () =>
  queryOptions({
    queryKey: briefKeys.quota(),
    queryFn: () => getBriefQuota(),
    staleTime: 60_000
  });
