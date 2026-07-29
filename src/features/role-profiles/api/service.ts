// ============================================================
// Role Profiles Service — Data Access Layer
// ============================================================
// Pattern 1: Server Actions + ORM. See the note in
// src/features/people/api/service.ts for why 'use server' is required rather
// than stylistic.
// ============================================================

'use server';

import { asc, count, desc, eq, ilike } from 'drizzle-orm';
import { db } from '@/db';
import { person, roleProfile } from '@/db/schema';
import type {
  RoleProfileByIdResponse,
  RoleProfileFilters,
  RoleProfileMutationPayload,
  RoleProfilesResponse
} from './types';

const SORTABLE = {
  name: roleProfile.name,
  createdAt: roleProfile.createdAt
} as const;

function buildWhere(filters: RoleProfileFilters) {
  return filters.search?.trim() ? ilike(roleProfile.name, `%${filters.search.trim()}%`) : undefined;
}

function buildOrderBy(sort?: string) {
  const fallback = [asc(roleProfile.name)];
  if (!sort) return fallback;
  try {
    const parsed = JSON.parse(sort) as { id: string; desc: boolean }[];
    const mapped = parsed
      .filter((s) => s.id in SORTABLE)
      .map((s) => {
        const col = SORTABLE[s.id as keyof typeof SORTABLE];
        return s.desc ? desc(col) : asc(col);
      });
    return mapped.length > 0 ? mapped : fallback;
  } catch {
    return fallback;
  }
}

export async function getRoleProfiles(filters: RoleProfileFilters): Promise<RoleProfilesResponse> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 10));
  const offset = (page - 1) * limit;
  const where = buildWhere(filters);

  // LEFT JOIN + GROUP BY so a profile with zero people still appears with 0
  // rather than being dropped by the join.
  const rows = await db
    .select({
      id: roleProfile.id,
      name: roleProfile.name,
      trackedSignals: roleProfile.trackedSignals,
      quotaConfig: roleProfile.quotaConfig,
      sourceChannels: roleProfile.sourceChannels,
      createdAt: roleProfile.createdAt,
      updatedAt: roleProfile.updatedAt,
      peopleCount: count(person.id)
    })
    .from(roleProfile)
    .leftJoin(person, eq(person.roleProfileId, roleProfile.id))
    .where(where)
    .groupBy(roleProfile.id)
    .orderBy(...buildOrderBy(filters.sort))
    .limit(limit)
    .offset(offset);

  const [totals] = await db.select({ value: count() }).from(roleProfile).where(where);

  return {
    roleProfiles: rows.map((r) => ({ ...r, peopleCount: Number(r.peopleCount) })),
    total_role_profiles: Number(totals?.value ?? 0),
    offset,
    limit
  };
}

export async function getRoleProfileById(id: string): Promise<RoleProfileByIdResponse> {
  const [row] = await db
    .select({
      id: roleProfile.id,
      name: roleProfile.name,
      trackedSignals: roleProfile.trackedSignals,
      quotaConfig: roleProfile.quotaConfig,
      sourceChannels: roleProfile.sourceChannels,
      createdAt: roleProfile.createdAt,
      updatedAt: roleProfile.updatedAt,
      peopleCount: count(person.id)
    })
    .from(roleProfile)
    .leftJoin(person, eq(person.roleProfileId, roleProfile.id))
    .where(eq(roleProfile.id, id))
    .groupBy(roleProfile.id)
    .limit(1);

  return {
    success: Boolean(row),
    roleProfile: row ? { ...row, peopleCount: Number(row.peopleCount) } : null
  };
}

export async function createRoleProfile(data: RoleProfileMutationPayload) {
  const [created] = await db.insert(roleProfile).values(data).returning({ id: roleProfile.id });
  return { success: true, id: created.id };
}

export async function updateRoleProfile(id: string, data: RoleProfileMutationPayload) {
  await db.update(roleProfile).set(data).where(eq(roleProfile.id, id));
  return { success: true, id };
}
