import { queryOptions } from '@tanstack/react-query';
import { getBoard, getProjects } from './service';
import type { BoardResponse, ProjectListResponse } from './types';

export type { BoardResponse, ProjectListResponse };

/**
 * Key factory. Server prefetch and client consumption MUST build keys from these
 * same functions — a hand-written key on one side misses the hydration and the
 * client silently refetches, which shows as a flash rather than an error.
 */
export const trackerKeys = {
  all: ['tracker'] as const,
  projects: () => [...trackerKeys.all, 'projects'] as const,
  board: (projectId: string) => [...trackerKeys.all, 'board', projectId] as const
};

export const projectsQueryOptions = () =>
  queryOptions({
    queryKey: trackerKeys.projects(),
    queryFn: () => getProjects()
  });

export const boardQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: trackerKeys.board(projectId),
    queryFn: () => getBoard(projectId)
  });
