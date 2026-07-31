import { mutationOptions } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { personKeys } from '@/features/people/api/queries';
import { createPersonFromIdentity, linkIdentity, unlinkIdentity } from './service';
import { identityKeys } from './queries';
import type { MutationResult } from './types';

/**
 * Every mutation invalidates BOTH key trees.
 *
 * Linking changes the unresolved queue AND what the People pages show, and a
 * create-from-identity adds a person outright. Invalidating only `identityKeys`
 * would leave the People table stale until a hard refresh.
 */
function invalidateAll() {
  const qc = getQueryClient();
  qc.invalidateQueries({ queryKey: identityKeys.all });
  qc.invalidateQueries({ queryKey: personKeys.all });
}

export const linkIdentityMutation = mutationOptions({
  mutationFn: (values: { identityId: string; personId: string }): Promise<MutationResult> =>
    linkIdentity(values),
  onSuccess: invalidateAll
});

export const createPersonFromIdentityMutation = mutationOptions({
  mutationFn: (values: {
    identityId: string;
    name: string;
    email?: string;
  }): Promise<MutationResult> => createPersonFromIdentity(values),
  onSuccess: invalidateAll
});

export const unlinkIdentityMutation = mutationOptions({
  mutationFn: (values: { identityId: string }): Promise<MutationResult> => unlinkIdentity(values),
  onSuccess: invalidateAll
});
