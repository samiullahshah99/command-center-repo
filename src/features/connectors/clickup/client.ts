/**
 * ClickUp API client — thin, typed wrappers over the v2 REST API.
 *
 * ⚠️ SCOPE: ClickUp is explicitly TEMPORARY. Everything here takes values as
 * PARAMETERS and makes no product decisions, because anything that encodes a
 * ClickUp-shaped assumption gets thrown away when it is replaced.
 *
 * Deliberately NOT here (see TODOs at the call sites that will need them):
 *   - person -> ClickUp user id mapping
 *   - which list a new task belongs in
 *   - status taxonomy mapping (our lifecycle <-> ClickUp statuses)
 *   - write retry / partial-failure handling
 *   - any brief- or content-specific queries
 */

import * as z from 'zod';
import { CLICKUP_BASE_URL, clickUpAuthHeaders } from './index';
import {
  clickUpListsResponseSchema,
  clickUpSpacesResponseSchema,
  clickUpTaskSchema,
  clickUpTasksResponseSchema,
  clickUpTeamsResponseSchema,
  type ClickUpCustomField,
  type ClickUpList,
  type ClickUpSpace,
  type ClickUpTask,
  type ClickUpTeam
} from './schemas';

// ── Rate limits ─────────────────────────────────────────────────────────────
/**
 * ClickUp's documented limits, per token:
 *   Free / Unlimited / Business : 100 requests per minute
 *   Business Plus               : 1,000 per minute
 *   Enterprise                  : 10,000 per minute
 *
 * A 429 includes `X-RateLimit-Reset` (epoch seconds) and sometimes `Retry-After`
 * (seconds). We honour whichever is present rather than guessing, and fall back
 * to exponential backoff when neither is.
 */
export const CLICKUP_RATE_LIMIT_PER_MINUTE = 100;

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export class ClickUpApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'ClickUpApiError';
  }
}

export class ClickUpSchemaError extends Error {
  constructor(
    readonly path: string,
    readonly issues: z.core.$ZodIssue[]
  ) {
    // Loud on purpose: a silent shape change is the failure mode this guards.
    super(
      `ClickUp response for ${path} did not match the expected shape. ` +
        `This usually means the API changed. Issues: ${issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`
    );
    this.name = 'ClickUpSchemaError';
  }
}

function backoffMs(attempt: number, res?: Response): number {
  // Prefer what the server told us.
  const retryAfter = res?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
  }

  const reset = res?.headers.get('x-ratelimit-reset');
  if (reset) {
    const resetAt = Number(reset) * 1000;
    if (Number.isFinite(resetAt)) {
      const delta = resetAt - Date.now();
      if (delta > 0) return Math.min(delta, MAX_BACKOFF_MS);
    }
  }

  // Exponential fallback: 1s, 2s, 4s…
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

/** Injectable so tests do not actually sleep. */
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export type ClickUpClientOptions = {
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  sleep?: Sleep;
  baseUrl?: string;
};

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit,
  opts: ClickUpClientOptions = {}
): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? realSleep;
  const baseUrl = opts.baseUrl ?? CLICKUP_BASE_URL;

  let lastRes: Response | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await doFetch(`${baseUrl}${path}`, {
      ...init,
      // Raw token, NO Bearer prefix — see clickUpAuthHeaders().
      headers: { ...clickUpAuthHeaders(), ...init.headers }
    });
    lastRes = res;

    if (res.status === 429) {
      if (attempt === MAX_RETRIES) {
        throw new ClickUpApiError(
          `Rate limited by ClickUp after ${MAX_RETRIES + 1} attempts (limit is ~${CLICKUP_RATE_LIMIT_PER_MINUTE}/min).`,
          429
        );
      }
      await sleep(backoffMs(attempt, res));
      continue;
    }

    const body: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      const e = body as { err?: string; ECODE?: string } | null;
      throw new ClickUpApiError(e?.err ?? `HTTP ${res.status}`, res.status, e?.ECODE);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ClickUpSchemaError(path, parsed.error.issues);
    }
    return parsed.data;
  }

  throw new ClickUpApiError(`Request to ${path} failed`, lastRes?.status ?? 0);
}

// ── Custom field normalisation ──────────────────────────────────────────────
/**
 * ClickUp returns custom fields as an ARRAY of `{ id, name, type, value }`, not a
 * keyed map, so reading one means scanning the array every time.
 *
 * This converts it to a map keyed by field NAME, preserving the whole field
 * object rather than flattening to the value. Two reasons:
 *
 *   1. `value` is polymorphic — string, number, array of option objects, or a
 *      user object depending on `type`. Flattening would need type-specific
 *      coercion, which is interpretation, and interpreting wrong silently
 *      corrupts data. The caller can branch on `type` when it actually needs to.
 *   2. Keeping `id` matters: writes address custom fields by id, not name.
 *
 * Keyed by name because that is what a human writing a query knows. Names are
 * NOT guaranteed unique in ClickUp — on collision the LAST field wins and a
 * warning is emitted rather than silently discarding one.
 */
export function normaliseCustomFields(
  fields: ClickUpCustomField[]
): Record<string, ClickUpCustomField> {
  const out: Record<string, ClickUpCustomField> = {};
  for (const field of fields) {
    if (out[field.name]) {
      console.warn(
        `[clickup] duplicate custom field name "${field.name}" (ids ${out[field.name].id}, ${field.id}) — last wins.`
      );
    }
    out[field.name] = field;
  }
  return out;
}

// ── Read methods ────────────────────────────────────────────────────────────

export type TaskFilters = {
  /** ClickUp pages are 0-indexed. */
  page?: number;
  archived?: boolean;
  /** ClickUp user ids. TODO: mapping from person -> ClickUp user id is out of scope. */
  assignees?: string[];
  /** Raw ClickUp status names. TODO: our lifecycle <-> ClickUp taxonomy mapping is out of scope. */
  statuses?: string[];
  subtasks?: boolean;
  include_closed?: boolean;
};

export async function getTasks(
  listId: string,
  filters: TaskFilters = {},
  opts: ClickUpClientOptions = {}
): Promise<{ tasks: ClickUpTask[]; lastPage: boolean }> {
  const params = new URLSearchParams();
  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.archived !== undefined) params.set('archived', String(filters.archived));
  if (filters.subtasks !== undefined) params.set('subtasks', String(filters.subtasks));
  if (filters.include_closed !== undefined) {
    params.set('include_closed', String(filters.include_closed));
  }
  // Array params repeat the key rather than using CSV.
  for (const a of filters.assignees ?? []) params.append('assignees[]', a);
  for (const s of filters.statuses ?? []) params.append('statuses[]', s);

  const qs = params.toString();
  const body = await request(
    `/list/${listId}/task${qs ? `?${qs}` : ''}`,
    clickUpTasksResponseSchema,
    { method: 'GET' },
    opts
  );

  return { tasks: body.tasks, lastPage: body.last_page ?? true };
}

export async function getTask(
  taskId: string,
  opts: ClickUpClientOptions = {}
): Promise<ClickUpTask> {
  return request(`/task/${taskId}`, clickUpTaskSchema, { method: 'GET' }, opts);
}

/**
 * Lists live under either a folder or a space. Exactly one must be given —
 * ClickUp has separate endpoints and there is no combined one.
 */
export async function getLists(
  parent: { spaceId: string } | { folderId: string },
  opts: ClickUpClientOptions = {}
): Promise<ClickUpList[]> {
  const path =
    'folderId' in parent
      ? `/folder/${parent.folderId}/list`
      : // Folderless lists live directly on the space.
        `/space/${parent.spaceId}/list`;

  const body = await request(path, clickUpListsResponseSchema, { method: 'GET' }, opts);
  return body.lists;
}

export async function getSpaces(
  teamId: string,
  opts: ClickUpClientOptions = {}
): Promise<ClickUpSpace[]> {
  const body = await request(
    `/team/${teamId}/space`,
    clickUpSpacesResponseSchema,
    { method: 'GET' },
    opts
  );
  return body.spaces;
}

export async function getTeams(opts: ClickUpClientOptions = {}): Promise<ClickUpTeam[]> {
  const body = await request('/team', clickUpTeamsResponseSchema, { method: 'GET' }, opts);
  return body.teams;
}

// ── Write methods ───────────────────────────────────────────────────────────

/**
 * Thin pass-through. Every value is a parameter.
 *
 * TODO(out of scope): choosing `listId` is a product decision — list-selection
 * logic is not built here.
 * TODO(out of scope): `assignees` are ClickUp user ids; the person -> ClickUp
 * user mapping is not built here.
 * TODO(out of scope): no retry or partial-failure handling on writes. A failed
 * create throws and the caller decides.
 */
export type CreateTaskPayload = {
  name: string;
  description?: string;
  /** ClickUp user ids, not person ids. */
  assignees?: number[];
  /** Raw ClickUp status name, not our lifecycle status. */
  status?: string;
  /** Epoch millis. */
  due_date?: number;
  priority?: number;
};

export async function createTask(
  listId: string,
  payload: CreateTaskPayload,
  opts: ClickUpClientOptions = {}
): Promise<ClickUpTask> {
  return request(
    `/list/${listId}/task`,
    clickUpTaskSchema,
    { method: 'POST', body: JSON.stringify(payload) },
    opts
  );
}

/**
 * TODO(out of scope): `status` must be a status name that exists in the task's
 * list. Mapping our lifecycle status to a ClickUp status is not built here — the
 * caller passes the exact ClickUp string.
 */
export async function updateTaskStatus(
  taskId: string,
  status: string,
  opts: ClickUpClientOptions = {}
): Promise<ClickUpTask> {
  return request(
    `/task/${taskId}`,
    clickUpTaskSchema,
    { method: 'PUT', body: JSON.stringify({ status }) },
    opts
  );
}
