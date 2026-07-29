'use client';
import { Badge } from '@/components/ui/badge';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import type { RoleProfileRow } from '../../api/types';
import { Column, ColumnDef } from '@tanstack/react-table';
import { Icons } from '@/components/icons';
import { CellAction } from './cell-action';

const MAX_VISIBLE_SIGNALS = 3;

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export const columns: ColumnDef<RoleProfileRow>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: ({ column }: { column: Column<RoleProfileRow, unknown> }) => (
      <DataTableColumnHeader column={column} title='Name' />
    ),
    cell: ({ cell }) => (
      <span className='font-medium'>{cell.getValue<RoleProfileRow['name']>()}</span>
    ),
    meta: {
      label: 'Name',
      placeholder: 'Search role profiles...',
      variant: 'text',
      icon: Icons.text
    },
    enableColumnFilter: true
  },
  {
    id: 'trackedSignals',
    accessorKey: 'trackedSignals',
    enableSorting: false,
    header: 'TRACKED SIGNALS',
    // Summarised rather than dumped — some roles have five signals and the raw
    // JSON array makes the row unreadable.
    cell: ({ cell }) => {
      const signals = asStringArray(cell.getValue());
      if (signals.length === 0) {
        return <span className='text-muted-foreground text-sm'>None</span>;
      }
      const shown = signals.slice(0, MAX_VISIBLE_SIGNALS);
      const rest = signals.length - shown.length;
      return (
        <div className='flex flex-wrap gap-1'>
          {shown.map((s) => (
            <Badge key={s} variant='secondary' className='text-xs'>
              {s}
            </Badge>
          ))}
          {rest > 0 ? (
            <Badge variant='outline' className='text-xs'>
              +{rest} more
            </Badge>
          ) : null}
        </div>
      );
    }
  },
  {
    id: 'quotaConfig',
    accessorKey: 'quotaConfig',
    enableSorting: false,
    header: 'QUOTA CONFIG',
    // An empty {} is the common case today and must read as "not set", not as a
    // blank cell that looks like a rendering bug.
    cell: ({ cell }) => {
      const raw = cell.getValue();
      const keys = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw) : [];
      if (keys.length === 0) {
        return <span className='text-muted-foreground text-sm'>Not set</span>;
      }
      return <code className='text-xs'>{JSON.stringify(raw)}</code>;
    }
  },
  {
    id: 'peopleCount',
    accessorKey: 'peopleCount',
    enableSorting: false,
    header: 'PEOPLE',
    cell: ({ cell }) => {
      const n = cell.getValue<number>();
      return n === 0 ? (
        <span className='text-muted-foreground text-sm'>0</span>
      ) : (
        <Badge variant='outline'>{n}</Badge>
      );
    }
  },
  {
    id: 'actions',
    cell: ({ row }) => <CellAction data={row.original} />
  }
];
