'use client';

import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { useDataTable } from '@/hooks/use-data-table';
import { useSuspenseQuery } from '@tanstack/react-query';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { getSortingStateParser } from '@/lib/parsers';
import { useMemo } from 'react';
import { identitySourceOptionsQuery, unresolvedIdentitiesQueryOptions } from '../../api/queries';
import { buildColumns } from './columns';

// Must match the column ids in buildColumns().
const COLUMN_IDS = ['source', 'externalId', 'email', 'displayName', 'firstSeenAt'];

export function IdentityTable() {
  const [params] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    perPage: parseAsInteger.withDefault(10),
    name: parseAsString,
    source: parseAsString,
    // Same parser as the server — a different one changes the query key.
    sort: getSortingStateParser(COLUMN_IDS).withDefault([])
  });

  // ⚠️ Must be byte-identical in shape to the object built in identity-listing.tsx,
  // or the query key diverges, the dehydrated cache misses, and the table
  // refetches on mount with a visible flash.
  const filters = {
    page: params.page,
    limit: params.perPage,
    ...(params.name && { search: params.name }),
    ...(params.source && { sources: params.source }),
    ...(params.sort.length > 0 && { sort: JSON.stringify(params.sort) })
  };

  const { data } = useSuspenseQuery(unresolvedIdentitiesQueryOptions(filters));
  const { data: sourceOptions } = useSuspenseQuery(identitySourceOptionsQuery());

  const columns = useMemo(() => buildColumns(sourceOptions), [sourceOptions]);
  const pageCount = Math.ceil(data.total_identities / params.perPage);

  const { table } = useDataTable({
    data: data.identities,
    columns,
    pageCount,
    shallow: true,
    debounceMs: 500,
    initialState: { columnPinning: { right: ['actions'] } }
  });

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}
