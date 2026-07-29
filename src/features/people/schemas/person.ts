import * as z from 'zod';
import { insertPersonSchema } from '@/db/schema';

/**
 * Derived from the DB-level `insertPersonSchema` — NOT a parallel definition.
 * `name` keeps its DB validation (min length) untouched.
 *
 * The four id fields are widened because a text input yields '' for "empty",
 * while the column is nullable. The transform coerces '' -> null so the form
 * value and the column agree without the submit handler doing it by hand.
 */
// INPUT is `string` (what the text input yields) and OUTPUT is `string | null`.
// Do NOT add .nullable() here — that would widen the input type to
// `string | null`, which no longer matches PersonFormValues and the form
// validator rejects the schema outright.
const optionalText = z.string().transform((v) => (v.trim() === '' ? null : v.trim()));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const optionalUuid = optionalText.refine(
  (v) => v === null || UUID_RE.test(v),
  'Must be a valid role profile'
);

export const personFormSchema = insertPersonSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    roleProfileId: optionalUuid,
    slackId: optionalText,
    clickupId: optionalText,
    portalId: optionalText
  });

// Form state uses strings throughout — '' is the empty value the inputs produce.
export type PersonFormValues = {
  name: string;
  roleProfileId: string;
  slackId: string;
  clickupId: string;
  portalId: string;
};
