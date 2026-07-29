'use client';
import { Badge } from '@/components/ui/badge';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import type { PersonRow, RoleProfileOption } from '../../api/types';
import { Column, ColumnDef } from '@tanstack/react-table';
import { Icons } from '@/components/icons';
import { CellAction } from './cell-action';

// Deviation from the template: products/ has a module-level `columns` const
// because CATEGORY_OPTIONS is static. Role profiles come from the database, so
// the filter options must be injected — hence a factory.
export function buildColumns(roleProfileOptions: RoleProfileOption[]): ColumnDef<PersonRow>[] {
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: ({ column }: { column: Column<PersonRow, unknown> }) => (
        <DataTableColumnHeader column={column} title='Name' />
      ),
      cell: ({ cell }) => <span className='font-medium'>{cell.getValue<PersonRow['name']>()}</span>,
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
      header: ({ column }: { column: Column<PersonRow, unknown> }) => (
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
      id: 'slackId',
      accessorKey: 'slackId',
      header: ({ column }: { column: Column<PersonRow, unknown> }) => (
        <DataTableColumnHeader column={column} title='Slack ID' />
      ),
      // NULL is meaningful here — it is how "not yet mapped" is represented, so
      // it gets an explicit affordance rather than rendering as blank.
      cell: ({ cell }) => {
        const v = cell.getValue<PersonRow['slackId']>();
        return v ? (
          <code className='text-xs'>{v}</code>
        ) : (
          <span className='text-muted-foreground text-xs'>Not linked</span>
        );
      }
    },
    {
      id: 'clickupId',
      accessorKey: 'clickupId',
      header: ({ column }: { column: Column<PersonRow, unknown> }) => (
        <DataTableColumnHeader column={column} title='ClickUp ID' />
      ),
      cell: ({ cell }) => {
        const v = cell.getValue<PersonRow['clickupId']>();
        return v ? (
          <code className='text-xs'>{v}</code>
        ) : (
          <span className='text-muted-foreground text-xs'>Not linked</span>
        );
      }
    },
    {
      id: 'actions',
      cell: ({ row }) => <CellAction data={row.original} />
    }
  ];
}
