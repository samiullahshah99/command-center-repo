import type { RoleProfile } from '@/db/schema';

export type { RoleProfile };

// The listing needs a headcount per profile, which is a join the table should
// not have to compute itself.
export type RoleProfileRow = RoleProfile & { peopleCount: number };

export type RoleProfileFilters = {
  page?: number;
  limit?: number;
  search?: string;
  /** JSON-encoded TanStack sorting state. */
  sort?: string;
};

export type RoleProfilesResponse = {
  roleProfiles: RoleProfileRow[];
  total_role_profiles: number;
  offset: number;
  limit: number;
};

export type RoleProfileByIdResponse = {
  success: boolean;
  roleProfile: RoleProfileRow | null;
};

export type RoleProfileMutationPayload = {
  name: string;
  trackedSignals: string[];
  quotaConfig: Record<string, unknown>;
  sourceChannels: string[];
};
