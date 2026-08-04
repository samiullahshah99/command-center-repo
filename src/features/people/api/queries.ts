import { queryOptions } from '@tanstack/react-query';
import {
  getPeople,
  getPeopleBoard,
  getPersonById,
  getPersonPanel,
  getRoleProfileOptions
} from './service';
import type { PersonFilters, PersonRow } from './types';

export type { PersonRow };

export const personKeys = {
  all: ['people'] as const,
  list: (filters: PersonFilters) => [...personKeys.all, 'list', filters] as const,
  board: (filters: PersonFilters) => [...personKeys.all, 'board', filters] as const,
  panel: (id: string) => [...personKeys.all, 'panel', id] as const,
  detail: (id: string) => [...personKeys.all, 'detail', id] as const,
  roleProfileOptions: () => [...personKeys.all, 'role-profile-options'] as const
};

export const peopleBoardQueryOptions = (filters: PersonFilters) =>
  queryOptions({
    queryKey: personKeys.board(filters),
    queryFn: () => getPeopleBoard(filters)
  });

/**
 * Panel data for one person. Consumed with `enabled` gated on the drawer being
 * open, so the board fetches nothing per row — the whole point of loading on
 * expand rather than with the page.
 */
export const personPanelOptions = (id: string) =>
  queryOptions({
    queryKey: personKeys.panel(id),
    queryFn: () => getPersonPanel(id)
  });

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
