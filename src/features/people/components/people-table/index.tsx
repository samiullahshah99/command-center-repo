'use client';

import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { useDataTable } from '@/hooks/use-data-table';
import { useSuspenseQuery } from '@tanstack/react-query';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { getSortingStateParser } from '@/lib/parsers';
import { useMemo } from 'react';
import { peopleQueryOptions, roleProfileOptionsQuery } from '../../api/queries';
import { buildColumns } from './columns';

// Sortable/filterable ids must match the column ids in buildColumns().
const COLUMN_IDS = ['name', 'role', 'slackId', 'clickupId'];

export function PeopleTable() {
  const [params] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    perPage: parseAsInteger.withDefault(10),
    name: parseAsString,
    role: parseAsString,
    // Same parser as the server side — a different one changes the query key.
    sort: getSortingStateParser(COLUMN_IDS).withDefault([])
  });

  // Must be byte-identical in shape to the object built in people-listing.tsx.
  const filters = {
    page: params.page,
    limit: params.perPage,
    ...(params.name && { search: params.name }),
    ...(params.role && { roleProfiles: params.role }),
    ...(params.sort.length > 0 && { sort: JSON.stringify(params.sort) })
  };

  const { data } = useSuspenseQuery(peopleQueryOptions(filters));
  const { data: roleProfileOptions } = useSuspenseQuery(roleProfileOptionsQuery());

  const columns = useMemo(() => buildColumns(roleProfileOptions), [roleProfileOptions]);

  const pageCount = Math.ceil(data.total_people / params.perPage);

  const { table } = useDataTable({
    data: data.people,
    columns,
    pageCount,
    shallow: true,
    debounceMs: 500,
    initialState: {
      columnPinning: { right: ['actions'] }
    }
  });

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}
