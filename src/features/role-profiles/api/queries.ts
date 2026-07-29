import { queryOptions } from '@tanstack/react-query';
import { getRoleProfileById, getRoleProfiles } from './service';
import type { RoleProfileFilters, RoleProfileRow } from './types';

export type { RoleProfileRow };

export const roleProfileKeys = {
  all: ['role-profiles'] as const,
  list: (filters: RoleProfileFilters) => [...roleProfileKeys.all, 'list', filters] as const,
  detail: (id: string) => [...roleProfileKeys.all, 'detail', id] as const
};

export const roleProfilesQueryOptions = (filters: RoleProfileFilters) =>
  queryOptions({
    queryKey: roleProfileKeys.list(filters),
    queryFn: () => getRoleProfiles(filters)
  });

export const roleProfileByIdOptions = (id: string) =>
  queryOptions({
    queryKey: roleProfileKeys.detail(id),
    queryFn: () => getRoleProfileById(id)
  });
