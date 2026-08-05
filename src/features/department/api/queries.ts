import { queryOptions } from '@tanstack/react-query';
import { getDepartment } from './service';
import type { DepartmentDetail } from './types';

export type { DepartmentDetail };

export const departmentKeys = {
  all: ['department'] as const,
  /**
   * Keyed on the department and the UTC DAY, not the raw instant — keying on `now`
   * would mint a new entry per render and the client's key would never match the
   * server's prefetched one, which presents as a flash. Same pattern as My day.
   */
  detail: (departmentId: string, dayKey: string) =>
    [...departmentKeys.all, departmentId, dayKey] as const
};

/** ⚠️ Takes an ISO STRING so both sides of the SSR handoff build the same key. */
export const departmentQueryOptions = (departmentId: string, nowIso: string) =>
  queryOptions({
    queryKey: departmentKeys.detail(departmentId, nowIso.slice(0, 10)),
    queryFn: () => getDepartment(departmentId, new Date(nowIso))
  });
