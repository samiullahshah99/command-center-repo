/**
 * Typed accessors for runtime configuration.
 *
 * ⚠️ This is the ONLY place `process.env` should be read for these values. Do not
 * scatter `process.env.TASK_SOURCE_OF_RECORD` through feature code — the whole
 * point is that swapping the task system is a one-line change here.
 *
 * Everything is a FUNCTION, not a module-level constant. A constant would be
 * evaluated at import time, which means it is baked in during `next build` where
 * the variable may not exist. (That exact mistake broke the Docker build once
 * already — see the note in src/db/index.ts.)
 */

import { TASK_SOURCE_SYSTEMS, type TaskSourceSystem } from '@/db/schema';

export type { TaskSourceSystem };

const DEFAULT_TASK_SOURCE: TaskSourceSystem = 'clickup';

/**
 * Which system is currently the source of record for tasks.
 *
 * Context: the lead considers ClickUp TEMPORARY — in-platform brief creation and
 * studio stats APIs are expected to replace it. But PRD §3.2 keeps ClickUp as
 * system of record for now, and §5.1 requires meeting action items to sync into
 * it. This flag lets the codebase serve both without a migration; the schema
 * already supports either via tracked_item.source_system.
 *
 * Defaults to 'clickup'. An unrecognised value falls back to the default rather
 * than throwing, so a typo in Railway cannot take the app down — but it warns,
 * because silently ignoring config is its own kind of bug.
 */
export function taskSourceOfRecord(): TaskSourceSystem {
  const raw = process.env.TASK_SOURCE_OF_RECORD?.trim();

  if (!raw) return DEFAULT_TASK_SOURCE;

  if ((TASK_SOURCE_SYSTEMS as readonly string[]).includes(raw)) {
    return raw as TaskSourceSystem;
  }

  console.warn(
    `[config] TASK_SOURCE_OF_RECORD="${raw}" is not one of ${TASK_SOURCE_SYSTEMS.join(' | ')}. Falling back to "${DEFAULT_TASK_SOURCE}".`
  );
  return DEFAULT_TASK_SOURCE;
}

/** Convenience predicates, so call sites read as intent rather than comparison. */
export function isClickUpSourceOfRecord(): boolean {
  return taskSourceOfRecord() === 'clickup';
}

export function isInternalSourceOfRecord(): boolean {
  return taskSourceOfRecord() === 'internal';
}
