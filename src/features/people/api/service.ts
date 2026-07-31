// ============================================================
// People Service — Data Access Layer
// ============================================================
// Pattern 1 from src/features/products/api/service.ts: Server Actions + ORM.
//
// 'use server' is REQUIRED, not stylistic. queries.ts is consumed on both sides
// of the SSR handoff — the server prefetches, and every `shallow: true` nuqs
// filter change re-runs the same queryFn in the BROWSER. Drizzle and `pg`
// cannot run there, so these functions have to be callable as RPC.
//
// Every export in this file must be an async function ('use server' contract).
// Types live in ./types.ts for that reason.
// ============================================================

'use server';

import { and, asc, count, desc, eq, ilike, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { person, roleProfile } from '@/db/schema';
import type {
  PeopleResponse,
  PersonByIdResponse,
  PersonFilters,
  PersonMutationPayload,
  RoleProfileOption
} from './types';

const SORTABLE = {
  name: person.name,
  slackId: person.slackId,
  clickupId: person.clickupId,
  createdAt: person.createdAt
} as const;

const SELECTION = {
  id: person.id,
  name: person.name,
  // The resolver's only automatic cross-system join key — see person.email.
  email: person.email,
  roleProfileId: person.roleProfileId,
  slackId: person.slackId,
  clickupId: person.clickupId,
  portalId: person.portalId,
  createdAt: person.createdAt,
  updatedAt: person.updatedAt,
  roleProfileName: roleProfile.name
};

function buildWhere(filters: PersonFilters) {
  const clauses = [];

  if (filters.search?.trim()) {
    clauses.push(ilike(person.name, `%${filters.search.trim()}%`));
  }

  if (filters.roleProfiles?.trim()) {
    const ids = filters.roleProfiles
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length > 0) clauses.push(inArray(person.roleProfileId, ids));
  }

  return clauses.length > 0 ? and(...clauses) : undefined;
}

function buildOrderBy(sort?: string) {
  // Default ordering. Without a stable ORDER BY, Postgres may return rows in a
  // different order per page and pagination silently duplicates or skips rows.
  const fallback = [asc(person.name)];
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

export async function getPeople(filters: PersonFilters): Promise<PeopleResponse> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 10));
  const offset = (page - 1) * limit;
  const where = buildWhere(filters);

  const rows = await db
    .select(SELECTION)
    .from(person)
    .leftJoin(roleProfile, eq(roleProfile.id, person.roleProfileId))
    .where(where)
    .orderBy(...buildOrderBy(filters.sort))
    .limit(limit)
    .offset(offset);

  // Counted with the same WHERE but no join/limit, so pageCount reflects the
  // filtered total rather than the current page.
  const [totals] = await db.select({ value: count() }).from(person).where(where);

  return {
    people: rows,
    total_people: Number(totals?.value ?? 0),
    offset,
    limit
  };
}

export async function getPersonById(id: string): Promise<PersonByIdResponse> {
  const [row] = await db
    .select(SELECTION)
    .from(person)
    .leftJoin(roleProfile, eq(roleProfile.id, person.roleProfileId))
    .where(eq(person.id, id))
    .limit(1);

  return { success: Boolean(row), person: row ?? null };
}

/** Role profiles as select/filter options. Dynamic, unlike the template's static CATEGORY_OPTIONS. */
export async function getRoleProfileOptions(): Promise<RoleProfileOption[]> {
  const rows = await db
    .select({ value: roleProfile.id, label: roleProfile.name })
    .from(roleProfile)
    .orderBy(asc(roleProfile.name));
  return rows;
}

export async function createPerson(data: PersonMutationPayload) {
  const [created] = await db.insert(person).values(data).returning({ id: person.id });
  return { success: true, id: created.id };
}

export async function updatePerson(id: string, data: PersonMutationPayload) {
  await db.update(person).set(data).where(eq(person.id, id));
  return { success: true, id };
}
