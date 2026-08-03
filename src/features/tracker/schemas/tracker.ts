import { z } from 'zod';
import { TRACKED_ITEM_STATUSES } from '@/db/schema/tracked-item';

/**
 * Validation for the board's inline edits.
 *
 * ⚠️ Built FROM the Drizzle-mirrored enums, not redeclared. `TRACKED_ITEM_STATUSES`
 * is the same constant the table's Zod schema and the UI's status groups use, so
 * adding a status is one edit and cannot leave the three disagreeing — which is
 * how a value ends up selectable in the UI and rejected by the server.
 *
 * These run on the SERVER, in service.ts, on every mutation. Client-side
 * validation is a convenience; this is the boundary.
 */

export const updateItemStatusSchema = z.object({
  itemId: z.uuid('Not a valid item id'),
  status: z.enum(TRACKED_ITEM_STATUSES)
});

export const updateItemOwnerSchema = z.object({
  itemId: z.uuid('Not a valid item id'),
  // Explicitly nullable: clearing an owner is a legitimate edit, and is not the
  // same as leaving the field untouched.
  ownerPersonId: z.uuid('Not a valid person id').nullable()
});

export const updateItemDueDateSchema = z.object({
  itemId: z.uuid('Not a valid item id'),
  /** `yyyy-mm-dd`, or null to clear. */
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-mm-dd')
    .nullable()
});

export type UpdateItemStatusInput = z.infer<typeof updateItemStatusSchema>;
export type UpdateItemOwnerInput = z.infer<typeof updateItemOwnerSchema>;
export type UpdateItemDueDateInput = z.infer<typeof updateItemDueDateSchema>;
