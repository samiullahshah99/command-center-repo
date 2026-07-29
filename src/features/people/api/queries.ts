import { queryOptions } from '@tanstack/react-query';
import { getPeople, getPersonById, getRoleProfileOptions } from './service';
import type { PersonFilters, PersonRow } from './types';

export type { PersonRow };

export const personKeys = {
  all: ['people'] as const,
  list: (filters: PersonFilters) => [...personKeys.all, 'list', filters] as const,
  detail: (id: string) => [...personKeys.all, 'detail', id] as const,
  roleProfileOptions: () => [...personKeys.all, 'role-profile-options'] as const
};

export const peopleQueryOptions = (filters: PersonFilters) =>
  queryOptions({
    queryKey: personKeys.list(filters),
    queryFn: () => getPeople(filters)
  });

export const personByIdOptions = (id: string) =>
  queryOptions({
    queryKey: personKeys.detail(id),
    queryFn: () => getPersonById(id)
  });

export const roleProfileOptionsQuery = () =>
  queryOptions({
    queryKey: personKeys.roleProfileOptions(),
    queryFn: () => getRoleProfileOptions()
  });
