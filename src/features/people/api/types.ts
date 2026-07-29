import type { Person } from '@/db/schema';

export type { Person };

// A person row as the table needs it: the person plus the joined profile name.
// The join lives in the query, not in the table, so the client never has to
// resolve role_profile_id itself.
export type PersonRow = Person & { roleProfileName: string | null };

export type PersonFilters = {
  page?: number;
  limit?: number;
  search?: string;
  /** Comma-separated role_profile ids — the multiSelect filter serialises this way. */
  roleProfiles?: string;
  /** JSON-encoded TanStack sorting state, e.g. [{"id":"name","desc":false}] */
  sort?: string;
};

export type PeopleResponse = {
  people: PersonRow[];
  total_people: number;
  offset: number;
  limit: number;
};

export type PersonByIdResponse = {
  success: boolean;
  person: PersonRow | null;
};

export type PersonMutationPayload = {
  name: string;
  roleProfileId: string | null;
  slackId: string | null;
  clickupId: string | null;
  portalId: string | null;
};

export type RoleProfileOption = { value: string; label: string };
