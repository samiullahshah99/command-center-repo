'use client';

import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { useDataTable } from '@/hooks/use-data-table';
import { useSuspenseQuery } from '@tanstack/react-query';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { getSortingStateParser } from '@/lib/parsers';
import { useEffect, useMemo, useState } from 'react';
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

  /**
   * ⚠️ `now` IS RESOLVED AFTER MOUNT, AND IS NULL ON THE SERVER. This is the fix
   * for the violation CLAUDE.md flags as "the one most likely to bite next":
   * `columns.tsx` used to call `Date.now()` inside a cell renderer.
   *
   * That mismatches BY CONSTRUCTION — the server clock and the browser clock are
   * never the same instant, so any render where the string ticks over
   * (`2m ago` → `3m ago`) is a hydration mismatch, and React responds by
   * discarding the subtree. The symptom is this table rendering its toolbar and
   * its row-count footer with NO ROWS, which reads exactly like a failed query
   * and sends the investigation into the data layer. It cost an afternoon once
   * already on the meetings table.
   *
   * With `now` null on the server and on the first client render, both sides emit
   * the same pinned absolute date; the effect then swaps in the relative label.
   * No mismatch is possible because the two renders never disagree.
   */
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const columns = useMemo(() => buildColumns(sourceOptions, now), [sourceOptions, now]);
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
