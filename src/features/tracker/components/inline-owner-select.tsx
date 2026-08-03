'use client';

import { useMutation } from '@tanstack/react-query';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { updateOwnerMutation } from '../api/mutations';
import type { PersonRef } from '../api/types';

/**
 * Sentinel for "no owner".
 *
 * ⚠️ Radix Select forbids an empty-string value, and `null` is not a valid
 * SelectItem value either — so clearing an owner needs a real sentinel string
 * that is mapped back to null before it reaches the schema.
 */
const UNASSIGNED = '__unassigned__';

export function InlineOwnerSelect({
  itemId,
  projectId,
  value,
  roster
}: {
  itemId: string;
  projectId: string;
  value: PersonRef | null;
  roster: PersonRef[];
}) {
  const m = useMutation(updateOwnerMutation(projectId));

  return (
    <Select
      value={value?.id ?? UNASSIGNED}
      onValueChange={(next) =>
        m.mutate({ itemId, ownerPersonId: next === UNASSIGNED ? null : next })
      }
      disabled={m.isPending}
    >
      <SelectTrigger size='sm' className='h-8 w-[190px]'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>
          <span className='text-muted-foreground italic'>unassigned</span>
        </SelectItem>
        {roster.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className='flex items-center gap-2'>
              <Avatar className='size-5'>
                <AvatarFallback className='text-[9px]'>{p.initials}</AvatarFallback>
              </Avatar>
              {p.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
