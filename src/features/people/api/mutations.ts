import { mutationOptions } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { createPerson, updatePerson } from './service';
import { personKeys } from './queries';
import type { PersonMutationPayload } from './types';

// No delete mutation by design. Deleting a person CASCADEs their recurring_task
// rows and, through those, their completion_event history — see
// src/db/schema/recurring-task.ts. Create/update only.

export const createPersonMutation = mutationOptions({
  mutationFn: (data: PersonMutationPayload) => createPerson(data),
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: personKeys.all });
  }
});

export const updatePersonMutation = mutationOptions({
  mutationFn: ({ id, values }: { id: string; values: PersonMutationPayload }) =>
    updatePerson(id, values),
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: personKeys.all });
  }
});
