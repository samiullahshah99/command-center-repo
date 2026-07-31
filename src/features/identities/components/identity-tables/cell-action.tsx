'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import type { UnresolvedIdentityRow } from '../../api/types';
import { LinkIdentityDialog } from '../link-identity-dialog';

/**
 * A button, not the products template's dropdown.
 *
 * Linking is the ONLY action here and it is the reason the page exists, so
 * hiding it behind a menu adds a click to the one thing anyone came to do.
 */
export function CellAction({ data }: { data: UnresolvedIdentityRow }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size='sm' variant='outline' onClick={() => setOpen(true)}>
        <Icons.user className='mr-2 h-4 w-4' />
        Link
      </Button>
      {/* Mounted only while open, so the suggestions query does not fire per row. */}
      {open && <LinkIdentityDialog identity={data} open={open} onOpenChange={setOpen} />}
    </>
  );
}
