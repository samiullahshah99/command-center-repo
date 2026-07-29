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
import type { RoleProfileRow } from '../../api/types';
import { Icons } from '@/components/icons';
import { useRouter } from 'next/navigation';

interface CellActionProps {
  data: RoleProfileRow;
}

// Create/update only — no Delete, per this session's decision.
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
        <DropdownMenuItem onClick={() => router.push(`/dashboard/role-profiles/${data.id}`)}>
          <Icons.edit className='mr-2 h-4 w-4' /> Edit
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
