import { mutationOptions } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { createRoleProfile, updateRoleProfile } from './service';
import { roleProfileKeys } from './queries';
import type { RoleProfileMutationPayload } from './types';
import { personKeys } from '@/features/people/api/queries';

// No delete mutation. role_profile deletion is comparatively safe
// (person.role_profile_id is SET NULL), but create/update only was the decision
// for this session.

function invalidate() {
  const qc = getQueryClient();
  qc.invalidateQueries({ queryKey: roleProfileKeys.all });
  // People rows carry the joined profile name, and the People filter dropdown is
  // built from these rows — both go stale when a profile is renamed.
  qc.invalidateQueries({ queryKey: personKeys.all });
}

export const createRoleProfileMutation = mutationOptions({
  mutationFn: (data: RoleProfileMutationPayload) => createRoleProfile(data),
  onSuccess: invalidate
});

export const updateRoleProfileMutation = mutationOptions({
  mutationFn: ({ id, values }: { id: string; values: RoleProfileMutationPayload }) =>
    updateRoleProfile(id, values),
  onSuccess: invalidate
});
