import * as z from 'zod';

/**
 * Zod schemas for ClickUp API responses.
 *
 * ClickUp returns loosely-typed JSON — numeric ids arrive as strings, optional
 * fields vanish rather than being null, and shapes have changed between
 * undocumented revisions. Validating every response means a silent shape change
 * fails loudly at the boundary instead of surfacing as `undefined` three layers
 * away.
 *
 * Deliberately PERMISSIVE about fields we do not use: every object allows
 * unknown keys (Zod's default), so ClickUp adding a field never breaks us. What
 * is validated is the shape we actually read.
 */

/** ClickUp sends numeric ids as strings in some endpoints and numbers in others. */
const stringOrNumberId = z.union([z.string(), z.number()]).transform(String);

export const clickUpUserSchema = z.object({
  id: z.number(),
  username: z.string().nullish(),
  email: z.string().nullish(),
  color: z.string().nullish(),
  initials: z.string().nullish(),
  profilePicture: z.string().nullish()
});

export const clickUpStatusSchema = z.object({
  status: z.string(),
  color: z.string().nullish(),
  type: z.string().nullish(),
  orderindex: z.number().nullish()
});

/**
 * Custom fields arrive as an ARRAY of field objects, not a map:
 *
 *   [{ id, name, type, value }, ...]
 *
 * `value` is polymorphic — a string for text, a number for numeric, an array of
 * option objects for labels, an object for users. It is kept as `unknown` here
 * rather than being coerced, because guessing wrong silently corrupts data.
 * Normalisation into a keyed map happens in client.ts; see the note there.
 */
export const clickUpCustomFieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  value: z.unknown().optional()
});

export const clickUpTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  // ClickUp omits description entirely when empty rather than sending null.
  description: z.string().nullish(),
  text_content: z.string().nullish(),
  status: clickUpStatusSchema.nullish(),
  // Epoch millis as a STRING. Not parsed to Date here — that is interpretation,
  // and this layer only validates shape.
  date_created: z.string().nullish(),
  date_updated: z.string().nullish(),
  due_date: z.string().nullish(),
  url: z.string().nullish(),
  assignees: z.array(clickUpUserSchema).default([]),
  creator: clickUpUserSchema.nullish(),
  custom_fields: z.array(clickUpCustomFieldSchema).default([]),
  list: z.object({ id: stringOrNumberId, name: z.string().nullish() }).nullish(),
  folder: z.object({ id: stringOrNumberId, name: z.string().nullish() }).nullish(),
  space: z.object({ id: stringOrNumberId }).nullish()
});

export const clickUpTasksResponseSchema = z.object({
  tasks: z.array(clickUpTaskSchema),
  /** Present on v2 list endpoints; absent on some. Used for pagination. */
  last_page: z.boolean().optional()
});

export const clickUpListSchema = z.object({
  id: stringOrNumberId,
  name: z.string(),
  orderindex: z.number().nullish(),
  status: z.unknown().nullish(),
  task_count: z.union([z.number(), z.string()]).nullish(),
  folder: z.object({ id: stringOrNumberId, name: z.string().nullish() }).nullish(),
  space: z.object({ id: stringOrNumberId, name: z.string().nullish() }).nullish()
});

export const clickUpListsResponseSchema = z.object({
  lists: z.array(clickUpListSchema)
});

export const clickUpSpaceSchema = z.object({
  id: stringOrNumberId,
  name: z.string(),
  private: z.boolean().nullish()
});

export const clickUpSpacesResponseSchema = z.object({
  spaces: z.array(clickUpSpaceSchema)
});

export const clickUpTeamSchema = z.object({
  id: stringOrNumberId,
  name: z.string(),
  members: z.array(z.unknown()).default([])
});

export const clickUpTeamsResponseSchema = z.object({
  teams: z.array(clickUpTeamSchema)
});

export type ClickUpTask = z.infer<typeof clickUpTaskSchema>;
export type ClickUpList = z.infer<typeof clickUpListSchema>;
export type ClickUpSpace = z.infer<typeof clickUpSpaceSchema>;
export type ClickUpTeam = z.infer<typeof clickUpTeamSchema>;
export type ClickUpCustomField = z.infer<typeof clickUpCustomFieldSchema>;
export type ClickUpUser = z.infer<typeof clickUpUserSchema>;
