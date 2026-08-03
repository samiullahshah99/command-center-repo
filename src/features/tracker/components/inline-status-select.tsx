'use client';

import { useMutation } from '@tanstack/react-query';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { updateStatusMutation } from '../api/mutations';
import { STATUS_META, TRACKED_ITEM_STATUSES } from '../constants/tracker-options';
import type { TrackedItemStatus } from '../api/types';

export function InlineStatusSelect({
  itemId,
  projectId,
  value
}: {
  itemId: string;
  projectId: string;
  value: TrackedItemStatus;
}) {
  const m = useMutation(updateStatusMutation(projectId));

  return (
    <Select
      value={value}
      onValueChange={(next) => m.mutate({ itemId, status: next as TrackedItemStatus })}
      // Disabled mid-flight so a second change cannot race the first — two
      // in-flight optimistic patches settle in arrival order, not click order.
      disabled={m.isPending}
    >
      <SelectTrigger size='sm' className='h-8 w-[150px]'>
        <span className='flex items-center gap-2'>
          <span className={cn('size-2 shrink-0 rounded-full', STATUS_META[value].dot)} />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {TRACKED_ITEM_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            <span className='flex items-center gap-2'>
              <span className={cn('size-2 shrink-0 rounded-full', STATUS_META[s].dot)} />
              {STATUS_META[s].label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
