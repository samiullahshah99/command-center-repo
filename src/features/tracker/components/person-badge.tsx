'use client';

import Link from 'next/link';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { OwnerConfidence, PersonRef } from '../api/types';
import { ownerWasUncertain } from '../constants/tracker-options';

/**
 * Owner cell: avatar + name, linking to the existing person page.
 *
 * ⚠️ Initials only — `person` has no image column, and adding one was not part
 * of this increment. AvatarFallback is the whole avatar here, not a fallback.
 *
 * The link points at /dashboard/people, which already exists. Not rebuilt.
 */
export function PersonBadge({
  person,
  originOwnerConfidence,
  className
}: {
  person: PersonRef | null;
  originOwnerConfidence?: OwnerConfidence | null;
  className?: string;
}) {
  const uncertain = ownerWasUncertain(originOwnerConfidence ?? null);

  if (!person) {
    return (
      <span className={cn('text-muted-foreground text-sm italic', className)}>unassigned</span>
    );
  }

  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Avatar className='size-6'>
        <AvatarFallback className='text-[10px] font-medium'>{person.initials}</AvatarFallback>
      </Avatar>

      <Link
        // Links to the PROFILE, not the people list filter: the question a
        // reader has when clicking an owner on the board is "what else is this
        // person carrying / is any of it slipping", which is what the profile
        // answers. /dashboard/people is the admin roster and answers neither.
        href={`/dashboard/people/${person.id}/profile`}
        className='text-sm hover:underline'
      >
        {person.name}
      </Link>

      {/*
        ⚠️ Subtle by design — a small amber dot, not a badge.

        This item was ALREADY reviewed by a human; the marker says the owner
        began as a name-similarity guess, which is worth a second look but is not
        an error. A loud treatment here would make a working board look broken,
        and the review queue (a later increment) is where uncertainty gets its
        full weight.
      */}
      {uncertain && (
        <span
          title={`Owner came from a '${originOwnerConfidence}' match — a name-similarity suggestion, not a verified link`}
          className='inline-flex items-center'
        >
          <Icons.alertCircle className='size-3.5 text-amber-600 dark:text-amber-400' />
        </span>
      )}
    </span>
  );
}
