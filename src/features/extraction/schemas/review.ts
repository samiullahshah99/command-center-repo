import { z } from 'zod';
import { EDITABLE_FIELDS } from '../constants/promotion';

/**
 * Reviewer edits applied at approval time.
 *
 * ⚠️ THESE DO NOT OVERWRITE THE CANDIDATE. The corrected values go onto the new
 * tracked_item; `candidate_action_item` keeps what the MODEL said, and
 * `edited_fields` records which of these a human had to change. Writing them
 * back would destroy the thing the precision metric measures — you could no
 * longer ask what the model actually produced.
 *
 * Only three fields are a reviewer's to change. `source_span` and `confidence`
 * are the model's record: correcting the quote would erase the evidence the
 * item is verified against.
 */
export const candidateEditsSchema = z.object({
  description: z.string().min(1, 'A description is required').optional(),
  ownerPersonId: z.uuid('Not a valid person id').nullable().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-mm-dd')
    .nullable()
    .optional()
});

export const approveCandidateSchema = z.object({
  candidateId: z.uuid('Not a valid candidate id'),
  edits: candidateEditsSchema.optional()
});

export const rejectCandidateSchema = z.object({
  candidateId: z.uuid('Not a valid candidate id')
});

export type CandidateEdits = z.infer<typeof candidateEditsSchema>;
export type ApproveCandidateInput = z.infer<typeof approveCandidateSchema>;
export type RejectCandidateInput = z.infer<typeof rejectCandidateSchema>;

export { EDITABLE_FIELDS };
