import { mutationOptions } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { regeneratePersonSummary } from './service';
import { personProfileKeys } from './queries';
import type { RegenerateResult } from './types';

/**
 * Manual regenerate.
 *
 * Not optimistic, deliberately — there is nothing to optimistically show. The
 * new text is unknown until the model answers, and a spinner that resolves into
 * real prose is more honest than a placeholder that gets replaced.
 */
export const regenerateSummaryMutation = mutationOptions({
  mutationFn: (personId: string): Promise<RegenerateResult> => regeneratePersonSummary(personId),
  onSuccess: (result, personId) => {
    if (!result.ok) return;
    const qc = getQueryClient();
    qc.invalidateQueries({ queryKey: personProfileKeys.profile(personId) });
  }
});
