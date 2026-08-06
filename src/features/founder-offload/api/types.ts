/**
 * ⚠️ THESE TYPES DESCRIBE A MODEL THAT DOES NOT EXIST.
 *
 * There is no `founder_offload` table, no offload columns anywhere, and
 * `source_type` is a pgEnum whose values are `meeting | slack | manual | system`
 * — it has no `founder_offload` member (audit §2.8). Nothing here mirrors a
 * Drizzle table, because there is no table to mirror.
 *
 * They exist so the screen has a typed seam to render against. When the model is
 * designed, these are a starting sketch to argue with, NOT a schema to implement
 * as-is — in particular `OffloadStatus` is a guess at the workflow's stages.
 */

/**
 * The offload workflow's stages.
 *
 * ⚠️ `assigned` and `in_transition` are SEPARATE stages that the stat row folds
 * into one bucket — see `deriveStats` in ./service.ts. Do not collapse them here:
 * "Ardin has named an owner" and "the owner is actually doing it" are different
 * facts, and the whole point of the screen is the gap between them.
 */
export const OFFLOAD_STATUSES = ['proposed', 'assigned', 'in_transition', 'handed_off'] as const;
export type OffloadStatus = (typeof OFFLOAD_STATUSES)[number];

export type OffloadRow = {
  id: string;
  /** What is coming off the founder's plate. */
  task: string;
  /** One line of context under the task. */
  note: string;
  /**
   * ⚠️ NULLABLE, and that is a real stage rather than missing data. The workflow
   * is "Damian surfaces a task → Ardin assigns an owner", so a `proposed` row has
   * nobody on it yet. A sample where every row is already owned would misrepresent
   * the very workflow it is previewing.
   */
  ownerName: string | null;
  /** Weekly hours the task is estimated to cost its owner. */
  hoursPerWeek: number;
  status: OffloadStatus;
};

export type OffloadStats = {
  proposed: number;
  /** `assigned` + `in_transition` — see `deriveStats`. */
  inTransition: number;
  handedOff: number;
};

export type FounderOffload = {
  rows: OffloadRow[];
  /**
   * ⚠️ DERIVED FROM `rows`, never authored alongside them. See `deriveStats` —
   * a hand-written count is a number with no row behind it, which is the one
   * thing this codebase's no-ghost rule forbids, sample surface or not.
   */
  stats: OffloadStats;
  /**
   * ⚠️ ALWAYS TRUE TODAY, and it covers the WHOLE SCREEN rather than one widget.
   * This is the first fully sample-backed page in the build: there is no offload
   * model, so there is no real half. The caption renders from this flag.
   */
  isSample: boolean;
};
