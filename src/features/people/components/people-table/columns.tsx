'use client';
import { Badge } from '@/components/ui/badge';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { PersonBoardRow, RoleProfileOption } from '../../api/types';
import { ActivitySparkline } from '../activity-sparkline';
import { IdentityBadges } from '../identity-badges';
import { Column, ColumnDef } from '@tanstack/react-table';
import { Icons } from '@/components/icons';
import { CellAction } from './cell-action';

// Deviation from the template: products/ has a module-level `columns` const
// because CATEGORY_OPTIONS is static. Role profiles come from the database, so
// the filter options must be injected — hence a factory.
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * ⚠️ `now` is a PARAMETER, resolved once by the service and threaded in. Never a
 * clock read inside a cell renderer: the server and browser instants differ, so a
 * relative label that ticks over mid-render is a hydration mismatch and React
 * discards the subtree — which presents as a table with a toolbar, a row count,
 * and no rows.
 *
 * ⚠️ `slackId` / `clickupId` columns are GONE. They read `person.slack_id` /
 * `clickup_id`, which only the person form ever wrote and seed sets to NULL —
 * two permanently blank columns that looked like missing data but were an
 * abandoned representation. `person_identity` supersedes them, keyed on the PAIR
 * (source, external_id). The DB columns are deliberately NOT dropped.
 */
export function buildColumns(
  roleProfileOptions: RoleProfileOption[],
  now: Date,
  onOpen: (person: PersonBoardRow) => void
): ColumnDef<PersonBoardRow>[] {
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: ({ column }: { column: Column<PersonBoardRow, unknown> }) => (
        <DataTableColumnHeader column={column} title='Person' />
      ),
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className='flex items-center gap-3 py-1'>
            <Avatar className='size-9 shrink-0'>
              {/* No avatar_url column exists, so initials ARE the avatar. */}
              <AvatarFallback className='bg-slate-100 text-xs font-medium text-slate-600'>
                {initialsOf(p.name)}
              </AvatarFallback>
            </Avatar>
            <div className='flex min-w-0 flex-col'>
              {/* A real button: this opens the drawer and is the keyboard path. */}
              <button
                type='button'
                onClick={() => onOpen(p)}
                aria-label={`Open detail for ${p.name}`}
                className='truncate text-left text-sm font-medium hover:underline'
              >
                {p.name}
              </button>
              <span className='text-muted-foreground truncate text-xs'>
                {p.email ?? 'no email'}
              </span>
            </div>
          </div>
        );
      },
      meta: {
        label: 'Name',
        placeholder: 'Search people...',
        variant: 'text',
        icon: Icons.text
      },
      enableColumnFilter: true
    },
    {
      id: 'role',
      accessorKey: 'roleProfileId',
      enableSorting: false,
      header: ({ column }: { column: Column<PersonBoardRow, unknown> }) => (
        <DataTableColumnHeader column={column} title='Role Profile' />
      ),
      cell: ({ row }) => {
        const name = row.original.roleProfileName;
        if (!name) {
          return <span className='text-muted-foreground text-sm'>Unassigned</span>;
        }
        return <Badge variant='outline'>{name}</Badge>;
      },
      enableColumnFilter: true,
      meta: {
        label: 'role',
        variant: 'multiSelect',
        options: roleProfileOptions
      }
    },
    {
      id: 'systems',
      enableSorting: false,
      header: () => <span className='text-xs font-medium'>Connected systems</span>,
      cell: ({ row }) => <IdentityBadges identities={row.original.identities} now={now} />
    },
    {
      id: 'activity',
      enableSorting: false,
      header: () => <span className='text-xs font-medium'>Activity · 14d</span>,
      cell: ({ row }) => (
        <ActivitySparkline
          activity={row.original.activity}
          activityTotal={row.original.activityTotal}
          lastSeen={row.original.lastSeen}
          now={now}
        />
      )
    },
    {
      id: 'items',
      enableSorting: false,
      header: () => <span className='text-xs font-medium'>Open items</span>,
      cell: ({ row }) => {
        const { pendingCount, pendingNeedsReview } = row.original;
        // Em-dash, not "0" — this table is sparsely populated by design and a
        // column of zeros reads as a broken query.
        if (pendingCount === 0) return <span className='text-muted-foreground text-sm'>—</span>;
        return (
          <Badge
            variant='outline'
            title={
              pendingNeedsReview > 0
                ? `${pendingNeedsReview} of ${pendingCount} need review — owner match is fuzzy or unresolved`
                : `${pendingCount} pending review`
            }
            className={
              pendingNeedsReview > 0
                ? 'border-amber-200 bg-amber-50 font-normal text-amber-800'
                : 'border-slate-200 bg-slate-50 font-normal text-slate-700'
            }
          >
            {pendingCount} pending
            {pendingNeedsReview > 0 ? ` · ${pendingNeedsReview} to check` : ''}
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
