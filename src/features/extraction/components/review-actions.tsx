'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { approveCandidateMutation, rejectCandidateMutation } from '../api/mutations';
import type { ActionItemRow, ReviewResult } from '../api/types';

/**
 * Minimal approve / reject for the extraction detail page.
 *
 * ⚠️ NOT the review queue. That is a later increment with filtering, bulk
 * actions and keyboard flow. This exists so the loop
 * `transcript → items → approve → row on the tracker board` is demoable end to
 * end, and no more than that.
 *
 * Editing is deliberately narrow: description and due date only, inline, with
 * no owner picker — the owner comes from identity resolution and changing it
 * properly belongs with the review queue's suggestion UI. `source_span` and
 * `confidence` are the model's record and are not editable at all.
 */
export function ReviewActions({ item }: { item: ActionItemRow }) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(item.description);
  const [dueDate, setDueDate] = useState(item.dueDate ?? '');

  const approve = useMutation(approveCandidateMutation);
  const reject = useMutation(rejectCandidateMutation);

  const busy = approve.isPending || reject.isPending;
  const result: ReviewResult | undefined = approve.data ?? reject.data;

  // Already decided — either from this click or from a previous session.
  const decided = item.reviewStatus !== 'pending';

  if (decided || (result?.ok && (result.status === 'approved' || result.status === 'rejected'))) {
    return <Decided item={item} result={result} />;
  }

  return (
    <div className='flex flex-col gap-3 border-t pt-3'>
      {editing && (
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor={`desc-${item.id}`} className='text-xs'>
              Description
            </Label>
            <Input
              id={`desc-${item.id}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className='h-8 text-sm'
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor={`due-${item.id}`} className='text-xs'>
              Due date
            </Label>
            <Input
              id={`due-${item.id}`}
              type='date'
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className='h-8 text-sm'
            />
          </div>
        </div>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <Button
          size='sm'
          disabled={busy}
          onClick={() => {
            // Only send fields the reviewer actually touched — the server
            // compares against the model's values to decide edited_fields, and
            // sending everything would mark untouched fields as edited.
            const edits: { description?: string; dueDate?: string | null } = {};
            if (editing && description !== item.description) edits.description = description;
            if (editing && (dueDate || null) !== item.dueDate) edits.dueDate = dueDate || null;

            approve.mutate({
              candidateId: item.id,
              ...(Object.keys(edits).length > 0 ? { edits } : {})
            });
          }}
        >
          {approve.isPending ? (
            <>
              <Icons.spinner className='mr-1.5 size-3.5 animate-spin' />
              Approving…
            </>
          ) : (
            <>
              <Icons.check className='mr-1.5 size-3.5' />
              Approve
            </>
          )}
        </Button>

        <Button size='sm' variant='outline' disabled={busy} onClick={() => reject.mutate(item.id)}>
          <Icons.close className='mr-1.5 size-3.5' />
          Reject
        </Button>

        <Button size='sm' variant='ghost' disabled={busy} onClick={() => setEditing((v) => !v)}>
          <Icons.edit className='mr-1.5 size-3.5' />
          {editing ? 'Cancel edit' : 'Edit first'}
        </Button>

        {result && !result.ok && (
          <span
            className={cn(
              'text-xs',
              result.reason === 'already_decided' ? 'text-muted-foreground' : 'text-destructive'
            )}
          >
            {result.reason === 'already_decided'
              ? `Already ${result.currentStatus}.`
              : result.message}
          </span>
        )}
      </div>
    </div>
  );
}

/** Post-decision state, including the link to where the work now lives. */
function Decided({ item, result }: { item: ActionItemRow; result?: ReviewResult }) {
  const approved =
    item.reviewStatus === 'approved' ||
    item.reviewStatus === 'auto_approved' ||
    (result?.ok && result.status === 'approved');

  const promoted = result?.ok && result.status === 'approved' ? result.promoted : null;
  const edited =
    result?.ok && result.status === 'approved' ? result.editedFields : item.editedFields;

  return (
    <div className='flex flex-wrap items-center gap-2 border-t pt-3 text-xs'>
      {approved ? (
        <>
          <span className='flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300'>
            <Icons.circleCheck className='size-3.5' />
            Approved
          </span>
          {edited && edited.length > 0 && (
            <span className='text-muted-foreground'>· edited {edited.join(', ')}</span>
          )}
          {promoted && (
            <Link
              href={`/dashboard/tracker/${promoted.projectId}`}
              className='text-primary ml-auto inline-flex items-center gap-1 hover:underline'
            >
              On the board in {promoted.projectName}
              <Icons.chevronRight className='size-3.5' />
            </Link>
          )}
        </>
      ) : (
        <span className='text-muted-foreground flex items-center gap-1.5'>
          <Icons.circleX className='size-3.5' />
          Rejected
        </span>
      )}
    </div>
  );
}
