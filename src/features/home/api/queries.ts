import { queryOptions } from '@tanstack/react-query';
import { getHomeSnapshot } from './service';

export const homeKeys = {
  all: ['home'] as const,
  snapshot: () => [...homeKeys.all, 'snapshot'] as const
};

export const homeSnapshotQueryOptions = () =>
  queryOptions({
    queryKey: homeKeys.snapshot(),
    queryFn: () => getHomeSnapshot(),
    // The landing page is revisited constantly; a short stale window keeps
    // navigation instant without serving a materially old picture.
    staleTime: 30_000
  });
