'use client';

import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { useDataTable } from '@/hooks/use-data-table';
import { useSuspenseQuery } from '@tanstack/react-query';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { getSortingStateParser } from '@/lib/parsers';
import { useMemo, useState } from 'react';
import { peopleBoardQueryOptions, roleProfileOptionsQuery } from '../../api/queries';
import type { PersonBoardRow } from '../../api/types';
import { PersonDrawer } from '../person-drawer';
import { buildColumns } from './columns';

// Sortable/filterable ids must match the column ids in buildColumns().
/**
 * ⚠️ Sortable ids only. `slackId`/`clickupId` are gone with their columns, and the
 * three widget columns are deliberately NOT sortable: sorting by activity would
 * turn a seven-person visibility tool into a leaderboard.
 */
const COLUMN_IDS = ['name', 'role'];

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

  const { data } = useSuspenseQuery(peopleBoardQueryOptions(filters));
  const { data: roleProfileOptions } = useSuspenseQuery(roleProfileOptionsQuery());

  const [openPerson, setOpenPerson] = useState<PersonBoardRow | null>(null);

  /**
   * ⚠️ ONE `now` for the whole table, taken from the SERVER's value rather than
   * `new Date()`. Every relative label in every row derives from it — see the
   * note on buildColumns.
   */
  const now = useMemo(() => new Date(data.now), [data.now]);

  const columns = useMemo(
    () => buildColumns(roleProfileOptions, now, setOpenPerson),
    [roleProfileOptions, now]
  );

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
    <>
      <DataTable table={table}>
        <DataTableToolbar table={table} />
      </DataTable>

      {/* Panel data loads on OPEN, not with the table — see PersonDrawer. */}
      <PersonDrawer
        person={openPerson}
        open={Boolean(openPerson)}
        onOpenChange={(next) => !next && setOpenPerson(null)}
        editHref={openPerson ? `/dashboard/people/${openPerson.id}` : undefined}
      />
    </>
  );
}
