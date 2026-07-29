'use client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import type { PersonRow } from '../../api/types';
import { Icons } from '@/components/icons';
import { useRouter } from 'next/navigation';

interface CellActionProps {
  data: PersonRow;
}

// No Delete item, unlike the products template. Deleting a person CASCADEs
// their recurring_task rows and completion_event history, so it is not a
// one-click action this UI should offer.
export function CellAction({ data }: CellActionProps) {
  const router = useRouter();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger render={<Button variant='ghost' className='h-8 w-8 p-0' />}>
        <span className='sr-only'>Open menu</span>
        <Icons.ellipsis className='h-4 w-4' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuItem onClick={() => router.push(`/dashboard/people/${data.id}`)}>
          <Icons.edit className='mr-2 h-4 w-4' /> Edit
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
