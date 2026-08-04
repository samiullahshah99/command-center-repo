import { queryOptions } from '@tanstack/react-query';
import { getConnectorHealth } from './service';

export const connectorHealthKeys = {
  all: ['connector-health'] as const,
  health: () => [...connectorHealthKeys.all, 'health'] as const
};

export const connectorHealthQueryOptions = () =>
  queryOptions({
    queryKey: connectorHealthKeys.health(),
    queryFn: () => getConnectorHealth(),
    // Health data ages meaningfully; a stale window avoids refetching on every
    // remount while still updating within a minute of a navigation.
    staleTime: 30_000
  });
