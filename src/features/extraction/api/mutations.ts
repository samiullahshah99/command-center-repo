import { mutationOptions } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
// ⚠️ CROSS-FEATURE IMPORTS — key factories ONLY.
// Approving promotes a candidate into a tracked_item, which changes what the
// tracker board shows and what a person's counters say. Those caches must be
// invalidated or the loop "approve here, appear there" silently fails.
// Constants and key factories may cross a feature boundary; services, queries
// and mutations may not. See CLAUDE.md.
import { trackerKeys } from '@/features/tracker/api/queries';
import { personProfileKeys } from '@/features/person-profile/api/queries';
import { approveCandidate, rejectCandidate } from './service';
import { extractionKeys } from './queries';
import type { FetchExtractResult, ReviewResult } from './types';
import type { CandidateEdits } from '../schemas/review';

/**
 * Kick off fetch-and-extract for one meeting.
 *
 * ⚠️ A ROUTE HANDLER, not a Server Action, and deliberately so. This is the one
 * operation in the feature that WRITES — it stores a raw_event, pulls a real
 * transcript, and enqueues paid LLM work. Route handlers are what CLAUDE.md
 * reserves for that shape, and keeping it off the Server Actions surface means
 * the write path has one explicit, greppable endpoint rather than being one of
 * several exports from a module the browser can already invoke.
 */
async function fetchAndExtract(firefliesId: string): Promise<FetchExtractResult> {
  const res = await fetch(`/api/extraction/${encodeURIComponent(firefliesId)}/fetch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' }
  });

  // The handler answers with a structured failure for the cases worth showing on
  // a row — a plan restriction above all — so a non-2xx still carries a usable
  // body. Only fall back to a generic message when even that is unreadable.
  const body = (await res.json().catch(() => null)) as FetchExtractResult | null;
  if (body) return body;

  return { ok: false, reason: 'error', message: `Request failed (${res.status})` };
}

export const fetchAndExtractMutation = mutationOptions({
  mutationFn: (firefliesId: string) => fetchAndExtract(firefliesId),
  onSuccess: (result) => {
    const qc = getQueryClient();
    // The row's status changed, so the list is stale. The detail and status
    // queries are invalidated too: the user usually navigates straight there,
    // and arriving on a cached "not fetched" view reads as the action failing.
    qc.invalidateQueries({ queryKey: extractionKeys.all });
    if (result.ok) {
      qc.invalidateQueries({ queryKey: extractionKeys.status(result.firefliesId) });
    }
  }
});

// ── Review ──────────────────────────────────────────────────────────────────

/**
 * Everything a promotion touches.
 *
 * Not optimistic: the tracked_item's id, its project and its final title are all
 * decided server-side inside the transaction, so there is nothing honest to
 * render ahead of the answer. The button disables and the row settles.
 */
function invalidateAfterReview(result: ReviewResult) {
  if (!result.ok) return;
  const qc = getQueryClient();
  qc.invalidateQueries({ queryKey: extractionKeys.all });
  if (result.status === 'approved') {
    // The board gains a row and the projects rollups move.
    qc.invalidateQueries({ queryKey: trackerKeys.all });
    // The new owner's open/overdue counters move too.
    qc.invalidateQueries({ queryKey: personProfileKeys.all });
  }
}

export const approveCandidateMutation = mutationOptions({
  mutationFn: (vars: { candidateId: string; edits?: CandidateEdits }): Promise<ReviewResult> =>
    approveCandidate(vars),
  onSuccess: invalidateAfterReview
});

export const rejectCandidateMutation = mutationOptions({
  mutationFn: (candidateId: string): Promise<ReviewResult> => rejectCandidate({ candidateId }),
  onSuccess: invalidateAfterReview
});
