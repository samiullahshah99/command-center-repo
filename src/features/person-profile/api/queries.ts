import { queryOptions } from '@tanstack/react-query';
import { getPersonProfile, getRoster } from './service';
import type { PersonProfile } from './types';

export type { PersonProfile };

export const personProfileKeys = {
  all: ['person-profile'] as const,
  profile: (personId: string) => [...personProfileKeys.all, 'profile', personId] as const,
  roster: () => [...personProfileKeys.all, 'roster'] as const
};

export const personProfileOptions = (personId: string) =>
  queryOptions({
    queryKey: personProfileKeys.profile(personId),
    queryFn: () => getPersonProfile(personId)
  });

export const rosterOptions = () =>
  queryOptions({
    queryKey: personProfileKeys.roster(),
    queryFn: () => getRoster(),
    // The roster changes when somebody joins, not while a page is open.
    staleTime: 5 * 60 * 1000
  });
