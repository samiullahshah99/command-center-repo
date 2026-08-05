'use client';

import { Badge } from '@/components/ui/badge';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import type { Column, ColumnDef } from '@tanstack/react-table';
import { formatDuration, formatMeetingDate } from '../../constants/extraction-options';
import type { MeetingRow } from '../../api/types';
import { CellAction } from './cell-action';

/** The derived status, in words. Zero items is a result, never a failure. */
function StatusCell({ row }: { row: MeetingRow }) {
  switch (row.status) {
    case 'extracted':
      return (
        <Badge
          variant='outline'
          className='border-success/30 bg-success-muted text-success-muted-foreground text-xs'
        >
          fetched, {row.itemCount} item{row.itemCount === 1 ? '' : 's'}
        </Badge>
      );
    case 'extracted_empty':
      return (
        <Badge variant='outline' className='text-muted-foreground text-xs'>
          fetched, 0 items
        </Badge>
      );
    case 'pending':
      return (
        <Badge variant='outline' className='text-muted-foreground text-xs'>
          extracting…
        </Badge>
      );
    default:
      return (
        <Badge variant='outline' className='text-muted-foreground text-xs'>
          not fetched
        </Badge>
      );
  }
}

export const columns: ColumnDef<MeetingRow>[] = [
  {
    id: 'title',
    accessorKey: 'title',
    header: ({ column }: { column: Column<MeetingRow, unknown> }) => (
      <DataTableColumnHeader column={column} title='Meeting' />
    ),
    cell: ({ row }) => (
      <div className='flex flex-col'>
        <span className='font-medium'>{row.original.title ?? '(untitled)'}</span>
        <span className='text-muted-foreground font-mono text-[11px]'>
          {row.original.firefliesId}
        </span>
      </div>
    ),
    enableColumnFilter: true,
    meta: { label: 'Meeting', variant: 'text', placeholder: 'Search meetings…' }
  },
  {
    id: 'date',
    accessorKey: 'date',
    header: ({ column }: { column: Column<MeetingRow, unknown> }) => (
      <DataTableColumnHeader column={column} title='Date' />
    ),
    cell: ({ row }) => (
      <span className='text-muted-foreground text-sm'>{formatMeetingDate(row.original.date)}</span>
    )
  },
  {
    id: 'duration',
    accessorKey: 'durationSeconds',
    header: ({ column }: { column: Column<MeetingRow, unknown> }) => (
      <DataTableColumnHeader column={column} title='Duration' />
    ),
    cell: ({ row }) => (
      <span className='font-mono text-sm'>{formatDuration(row.original.durationSeconds)}</span>
    )
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: ({ column }: { column: Column<MeetingRow, unknown> }) => (
      <DataTableColumnHeader column={column} title='Status' />
    ),
    cell: ({ row }) => <StatusCell row={row.original} />
  },
  {
    id: 'actions',
    header: () => <div className='text-right'>Action</div>,
    cell: ({ row }) => <CellAction data={row.original} />
  }
];
