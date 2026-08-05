'use client';

import { Badge } from '@/components/ui/badge';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import { Icons } from '@/components/icons';
import { formatDateOnly, formatRelativeTime } from '@/lib/format-date';
import type { Column, ColumnDef } from '@tanstack/react-table';
import type { UnresolvedIdentityRow } from '../../api/types';
import { CellAction } from './cell-action';

/**
 * Filter options are injected rather than module-level, as in people-table:
 * the source list is read from the database so the dropdown only offers sources
 * that actually have unresolved identities.
 *
 * ⚠️ `now` IS NULLABLE, AND NULL IS THE SERVER. This used to be a local
 * `relative()` helper calling `Date.now()` in the cell renderer — the violation
 * CLAUDE.md singles out as the likeliest to bite, because it mismatches by
 * construction rather than only when locales differ. See the long note at the
 * `useState`/`useEffect` pair in `./index.tsx` for the failure mode.
 *
 * While null, cells render the pinned absolute date. Both formatters come from
 * `@/lib/format-date`, which pins locale AND timezone — the local helper this
 * replaced did neither.
 */
export function buildColumns(
  sourceOptions: { value: string; label: string }[],
  now: Date | null
): ColumnDef<UnresolvedIdentityRow>[] {
  return [
    {
      id: 'source',
      accessorKey: 'source',
      header: ({ column }: { column: Column<UnresolvedIdentityRow, unknown> }) => (
        <DataTableColumnHeader column={column} title='Source' />
      ),
      cell: ({ cell }) => (
        <Badge variant='outline' className='font-mono text-xs'>
          {cell.getValue<string>()}
        </Badge>
      ),
      enableColumnFilter: true,
      meta: { label: 'source', variant: 'multiSelect', options: sourceOptions }
    },
    {
      id: 'externalId',
      accessorKey: 'externalId',
      header: ({ column }: { column: Column<UnresolvedIdentityRow, unknown> }) => (
        <DataTableColumnHeader column={column} title='External ID' />
      ),
      // ⚠️ Opaque and only meaningful with its source — Vision, UGC and Command
      // Centre are three separate Clerk instances whose ids may collide.
      cell: ({ cell }) => (
        <span className='font-mono text-xs break-all'>{cell.getValue<string>()}</span>
      ),
      meta: {
        label: 'Search',
        placeholder: 'Search id, email or name...',
        variant: 'text',
        icon: Icons.text
      },
      enableColumnFilter: true
    },
    {
      id: 'email',
      accessorKey: 'email',
      header: ({ column }: { column: Column<UnresolvedIdentityRow, unknown> }) => (
        <DataTableColumnHeader column={column} title='Email' />
      ),
      // NULL is the interesting case: it is why the identity is unresolved at
      // all, so it gets an explicit affordance instead of rendering blank.
      cell: ({ cell }) => {
        const v = cell.getValue<string | null>();
        return v ? (
          <span className='text-sm'>{v}</span>
        ) : (
          <span className='text-muted-foreground text-xs italic'>none sent</span>
        );
      }
    },
    {
      id: 'displayName',
      accessorKey: 'displayName',
      header: ({ column }: { column: Column<UnresolvedIdentityRow, unknown> }) => (
        <DataTableColumnHeader column={column} title='Display name' />
      ),
      cell: ({ row }) => {
        const name = row.original.displayName ?? row.original.editorName;
        return name ? (
          // Labelled, because a name is never an identity key here.
          <span className='text-sm' title='Display only — never used to match'>
            {name}
          </span>
        ) : (
          <span className='text-muted-foreground text-xs italic'>—</span>
        );
      },
      enableSorting: false
    },
    {
      id: 'firstSeenAt',
      accessorKey: 'firstSeenAt',
      header: ({ column }: { column: Column<UnresolvedIdentityRow, unknown> }) => (
        <DataTableColumnHeader column={column} title='First seen' />
      ),
      cell: ({ cell }) => {
        // Both helpers take an ISO string. The column value arrives as a Date
        // (or as a string once it has round-tripped through the dehydrated
        // cache), so normalise before formatting rather than assuming either.
        const raw = cell.getValue<Date | string>();
        const iso = raw instanceof Date ? raw.toISOString() : String(raw);
        return (
          <span className='text-muted-foreground'>
            {now ? formatRelativeTime(iso, now) : formatDateOnly(iso)}
          </span>
        );
      }
    },
    {
      id: 'eventCount',
      accessorKey: 'eventCount',
      enableSorting: false,
      header: ({ column }: { column: Column<UnresolvedIdentityRow, unknown> }) => (
        <DataTableColumnHeader column={column} title='Events' />
      ),
      // How much history is waiting on this one decision.
      cell: ({ cell }) => {
        const n = cell.getValue<number>();
        return (
          <Badge variant={n > 0 ? 'secondary' : 'outline'} className='tabular-nums'>
            {n}
          </Badge>
        );
      }
    },
    {
      id: 'actions',
      cell: ({ row }) => <CellAction data={row.original} />
    }
  ];
}
