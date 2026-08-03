import { mutationOptions } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { updateItemDueDate, updateItemOwner, updateItemStatus } from './service';
import { trackerKeys } from './queries';
import type { BoardResponse, UpdateItemResult } from './types';
import type {
  UpdateItemDueDateInput,
  UpdateItemOwnerInput,
  UpdateItemStatusInput
} from '../schemas/tracker';

/**
 * Optimistic inline edits.
 *
 * ⚠️ THE SHAPE MATTERS, and all four callbacks are required together:
 *
 *   onMutate   cancel in-flight refetches, snapshot, patch the cache
 *   onError    restore the snapshot — the edit must VISIBLY fail, not vanish
 *   onSuccess  replace the patch with the server's row
 *   onSettled  invalidate, so the rollups on the projects page catch up
 *
 * Cancelling first is the part people drop: without it, a refetch already in
 * flight lands AFTER the optimistic patch and overwrites it with stale data, so
 * the edit appears to apply and then undo itself a moment later.
 */

/** Patch one item inside the cached board, leaving group membership correct. */
function patchBoard(
  board: BoardResponse | null | undefined,
  itemId: string,
  patch: (
    item: BoardResponse['groups'][number]['items'][number]
  ) => BoardResponse['groups'][number]['items'][number]
): BoardResponse | null | undefined {
  if (!board) return board;

  const all = board.groups.flatMap((g) => g.items);
  const target = all.find((i) => i.id === itemId);
  if (!target) return board;

  const updated = patch(target);

  // Rebuilt from the full list rather than edited in place: a status change
  // MOVES the row between groups, and patching within its current group would
  // leave it rendered under the wrong lane until the next refetch.
  return {
    ...board,
    groups: board.groups.map((g) => ({
      ...g,
      items: all.map((i) => (i.id === itemId ? updated : i)).filter((i) => i.status === g.status)
    }))
  };
}

type Ctx = { projectId: string; previous: BoardResponse | null | undefined };

function optimistic<TInput extends { itemId: string }>(
  mutationFn: (input: TInput) => Promise<UpdateItemResult>,
  apply: (
    item: BoardResponse['groups'][number]['items'][number],
    input: TInput
  ) => BoardResponse['groups'][number]['items'][number]
) {
  return (projectId: string) =>
    mutationOptions({
      mutationFn,
      onMutate: async (input: TInput): Promise<Ctx> => {
        const qc = getQueryClient();
        const key = trackerKeys.board(projectId);
        await qc.cancelQueries({ queryKey: key });
        const previous = qc.getQueryData<BoardResponse | null>(key);
        qc.setQueryData<BoardResponse | null>(
          key,
          (old) => patchBoard(old, input.itemId, (item) => apply(item, input)) ?? old ?? null
        );
        return { projectId, previous };
      },
      onError: (_err, _input, ctx) => {
        const qc = getQueryClient();
        if (ctx) qc.setQueryData(trackerKeys.board(ctx.projectId), ctx.previous);
      },
      onSuccess: (result, _input, ctx) => {
        const qc = getQueryClient();
        // A validation failure comes back as ok:false rather than a throw, so it
        // would NOT hit onError. Roll back here too or a rejected edit sticks.
        if (!result.ok) {
          if (ctx) qc.setQueryData(trackerKeys.board(ctx.projectId), ctx.previous);
          return;
        }
        qc.setQueryData<BoardResponse | null>(
          trackerKeys.board(projectId),
          (old) => patchBoard(old, result.item.id, () => result.item) ?? old ?? null
        );
      },
      onSettled: () => {
        const qc = getQueryClient();
        // The projects page shows open/overdue rollups derived from these rows.
        qc.invalidateQueries({ queryKey: trackerKeys.projects() });
      }
    });
}

export const updateStatusMutation = optimistic<UpdateItemStatusInput>(
  (input) => updateItemStatus(input),
  (item, input) => ({ ...item, status: input.status })
);

export const updateOwnerMutation = optimistic<UpdateItemOwnerInput>(
  (input) => updateItemOwner(input),
  (item, input) => ({
    ...item,
    // The name is unknown until the server answers; null clears it immediately
    // and onSuccess fills in the real PersonRef a moment later.
    owner: input.ownerPersonId === null ? null : item.owner
  })
);

export const updateDueDateMutation = optimistic<UpdateItemDueDateInput>(
  (input) => updateItemDueDate(input),
  (item, input) => ({
    ...item,
    dueDate: input.dueDate ? `${input.dueDate}T00:00:00.000Z` : null
  })
);
