import { z } from 'zod';
import { IDENTITY_SOURCES, insertPersonIdentitySchema } from '@/db/schema';

/**
 * Form schemas for identity linking.
 *
 * ⚠️ NO PARALLEL VALIDATION. These extend the Phase 1 schemas in
 * src/db/schema/person-identity.ts rather than restating the shape. The DB
 * schema owns what an identity IS; these only add what the FORM needs on top —
 * chiefly `linkedBy`, which is required here but nullable in the table because
 * an automatic email match has nobody to record.
 */

export const identitySourceSchema = z.enum(IDENTITY_SOURCES);

/** Attach an identity to a person that already exists. */
export const linkIdentitySchema = z.object({
  identityId: z.string().uuid('Pick an identity'),
  personId: z.string().uuid('Pick a person'),
  /**
   * Required, unlike the column. A null linked_by means "matched automatically";
   * anything done through this UI was decided by a human and must say so, or the
   * audit trail cannot tell the two apart.
   */
  linkedBy: z.string().min(1, 'linkedBy is required for a manual link')
});

/** Create a person straight from an unresolved identity. */
export const createPersonFromIdentitySchema = z.object({
  identityId: z.string().uuid(),
  name: z.string().min(1, 'Name is required'),
  /**
   * Seeds person.email so FUTURE identities from other systems auto-resolve.
   * Optional because Slack and most Vision events carry no address at all.
   */
  email: z
    .string()
    .email('Enter a valid email')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  linkedBy: z.string().min(1)
});

export const unlinkIdentitySchema = z.object({
  identityId: z.string().uuid()
});

export type LinkIdentityInput = z.infer<typeof linkIdentitySchema>;
export type CreatePersonFromIdentityInput = z.infer<typeof createPersonFromIdentitySchema>;
export type UnlinkIdentityInput = z.infer<typeof unlinkIdentitySchema>;

// Re-exported so callers never reach past this file for the base shape.
export { insertPersonIdentitySchema };
