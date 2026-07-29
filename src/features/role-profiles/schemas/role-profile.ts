import * as z from 'zod';
import { insertRoleProfileSchema } from '@/db/schema';

/**
 * Derived from the DB-level `insertRoleProfileSchema` — NOT a parallel
 * definition. `name`, `trackedSignals`, and `sourceChannels` keep their DB
 * validation as-is (string, string[], string[]).
 *
 * Only `quotaConfig` is replaced: the form edits it as raw JSON text because the
 * PRD does not define its shape (the seed leaves it `{}`). Forcing a structure
 * here would invent a contract. The string is validated to parse into a JSON
 * object, then converted before it reaches the payload.
 */
export const quotaConfigStringSchema = z.string().refine((s) => {
  const text = s.trim();
  if (text === '') return true; // treated as {}
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}, 'Must be a valid JSON object, e.g. {"briefs_per_week": 5}');

export const roleProfileFormSchema = insertRoleProfileSchema
  .omit({ id: true, createdAt: true, updatedAt: true, quotaConfig: true })
  .extend({
    // Required in the form even though the column has a default, so a profile is
    // never created with an unintentionally blank name.
    name: z.string().min(1, 'Name is required'),
    trackedSignals: z.array(z.string()),
    sourceChannels: z.array(z.string()),
    quotaConfig: quotaConfigStringSchema
  });

export type RoleProfileFormValues = {
  name: string;
  trackedSignals: string[];
  sourceChannels: string[];
  /** Raw JSON text, parsed on submit. */
  quotaConfig: string;
};

/** Parse the textarea value into the JSONB payload. */
export function parseQuotaConfig(text: string): Record<string, unknown> {
  const t = text.trim();
  if (t === '') return {};
  try {
    const parsed = JSON.parse(t);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Validation already rejects this path; fall through to a safe default.
  }
  return {};
}
