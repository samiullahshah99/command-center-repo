/**
 * The systems an item can come from or be pushed to.
 *
 * ⚠️ ONE list, shared by `tracked_item.source_system`,
 * `candidate_action_item.external_system` and `project.external_system`, so the
 * three cannot drift. Previously `tracked_item.source_system` was a Postgres
 * ENUM of ('clickup','internal') — which made adding Notion an `ALTER TYPE`,
 * a statement that cannot run inside a transaction and whose values can never
 * be removed. It is TEXT + CHECK everywhere now.
 *
 * ⚠️ ORIGIN vs DESTINATION — the columns do NOT mean the same thing:
 *
 *   tracked_item.source_system            where the row CAME FROM
 *   candidate_action_item.external_system where an approved item was PUSHED TO
 *   project.external_system               where the project MIRRORS FROM
 *
 * `clickup` is a legitimate ORIGIN — it is a read-only source for content-team
 * outputs. It is NOT a legitimate destination: CLAUDE.md states plainly that no
 * ClickUp write path exists and none is to be built. The shared list permits the
 * value; the no-write rule is enforced by there being no ClickUp write code, not
 * by this constraint. If that ever needs to be structural, narrow
 * candidate_action_item's own CHECK rather than splitting this list.
 */
export const EXTERNAL_SYSTEMS = ['internal', 'notion', 'clickup'] as const;

export type ExternalSystem = (typeof EXTERNAL_SYSTEMS)[number];

/**
 * ⚠️ WHERE A DESTINATION IS RECORDED — read this before writing sync code.
 *
 * `tracked_item.external_task_id` means **"this row MIRRORS an external
 * system"**. It is an ORIGIN pointer, enforced by `tracked_item_external_ref_ck`:
 * a non-internal row must have one, an internal row must not.
 *
 * It is NOT where a push destination goes. An item that originated INSIDE
 * Command Center and was later pushed out records that destination on
 * `candidate_action_item.external_task_id` / `.external_system`, reached from
 * the board via `tracked_item.candidate_action_item_id`:
 *
 *   tracked_item (source_system='internal', external_task_id NULL)
 *     └─ candidate_action_item_id ─→ candidate_action_item
 *                                      .external_system = 'notion'
 *                                      .external_task_id = <notion page id>
 *
 * **Day 2's Notion sync must follow this.** Writing the Notion page id onto
 * `tracked_item.external_task_id` would both violate the CHECK and redefine the
 * column from "mirrors" to "was pushed to" — two meanings in one column, which
 * is how you get a sync that cannot tell an imported task from an exported one.
 *
 * ⚠️ KNOWN GAP, accepted for now: a MANUALLY created tracked_item has no
 * candidate_action_item, so it has nowhere to record a destination at all. That
 * is fine while manual items are not synced outward. If manual-item sync is ever
 * needed, add a destination pair to `tracked_item` — do not overload
 * `external_task_id`.
 */

/** SQL fragment for a CHECK over the shared set. */
export const EXTERNAL_SYSTEMS_SQL = "('internal','notion','clickup')";
