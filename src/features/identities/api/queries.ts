import { queryOptions } from '@tanstack/react-query';
import {
  getIdentitiesForPerson,
  getIdentitySourceOptions,
  getIdentitySuggestions,
  getPersonOptions,
  getUnresolvedIdentities
} from './service';
import type { IdentityFilters } from './types';

export const identityKeys = {
  all: ['identities'] as const,
  list: (filters: IdentityFilters) => [...identityKeys.all, 'list', filters] as const,
  sourceOptions: () => [...identityKeys.all, 'source-options'] as const,
  personOptions: () => [...identityKeys.all, 'person-options'] as const,
  suggestions: (id: string) => [...identityKeys.all, 'suggestions', id] as const,
  forPerson: (personId: string) => [...identityKeys.all, 'for-person', personId] as const
};

export const unresolvedIdentitiesQueryOptions = (filters: IdentityFilters) =>
  queryOptions({
    queryKey: identityKeys.list(filters),
    queryFn: () => getUnresolvedIdentities(filters)
  });

export const identitySourceOptionsQuery = () =>
  queryOptions({
    queryKey: identityKeys.sourceOptions(),
    queryFn: () => getIdentitySourceOptions()
  });

export const personOptionsQuery = () =>
  queryOptions({
    queryKey: identityKeys.personOptions(),
    queryFn: () => getPersonOptions()
  });

/**
 * Suggestions are fetched only when the link dialog opens — they scan the whole
 * roster per identity, so prefetching them for every table row would do that
 * work N times for a dialog that is usually opened once.
 */
export const identitySuggestionsQuery = (identityId: string) =>
  queryOptions({
    queryKey: identityKeys.suggestions(identityId),
    queryFn: () => getIdentitySuggestions(identityId)
  });

export const identitiesForPersonQuery = (personId: string) =>
  queryOptions({
    queryKey: identityKeys.forPerson(personId),
    queryFn: () => getIdentitiesForPerson(personId)
  });
