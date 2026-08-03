'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { parseAsInteger, useQueryStates } from 'nuqs';
import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Icons } from '@/components/icons';
import { useDataTable } from '@/hooks/use-data-table';
import { getSortingStateParser } from '@/lib/parsers';
import { meetingsQueryOptions } from '../../api/queries';
import { columns } from './columns';

const columnIds = columns.map((c) => c.id).filter(Boolean) as string[];

/** Matches the server's default in meeting-listing.tsx — the keys must agree. */
const DEFAULT_LIMIT = 25;

export function MeetingTable() {
  // ⚠️ Read through nuqs even though the list is not server-paginated: the
  // DataTable writes `page`/`perPage` to the URL, and reading them here is what
  // keeps the table's own state and the address bar from disagreeing after a
  // back-navigation.
  const [params] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    perPage: parseAsInteger.withDefault(10),
    sort: getSortingStateParser(columnIds).withDefault([])
  });

  const { data } = useSuspenseQuery(meetingsQueryOptions(DEFAULT_LIMIT));

  const { table } = useDataTable({
    data: data.meetings,
    columns,
    pageCount: Math.max(1, Math.ceil(data.meetings.length / params.perPage)),
    shallow: true,
    debounceMs: 500,
    initialState: {
      columnPinning: { right: ['actions'] }
    }
  });

  // ⚠️ The banner is a CHILD of DataTable, not a sibling, and this is load-bearing
  // layout rather than taste.
  //
  // DataTable renders its rows inside `absolute inset-0` within a `relative flex
  // flex-1` box, so it only has height when its own `flex flex-1 flex-col` is a
  // direct flex item of PageContainer's column. Wrapping it in a plain
  // `<div className='flex flex-col gap-4'>` to sit the banner above it breaks that
  // chain: the wrapper sizes to content, flex-1 resolves against zero, and the
  // table collapses to zero height — header and rows still in the DOM, nothing
  // visible. The toolbar and pagination render OUTSIDE that box, so the page
  // looks like "5 row(s) total" with an empty void above it, which reads as a
  // data-fetching bug and is not one.
  //
  // DataTable renders {children} inside its own flex column, above the table, so
  // passing the banner here puts it in the right place with the chain intact.
  return (
    <DataTable table={table}>
      {data.listError && (
        <Alert variant={data.listError.reason === 'plan' ? 'default' : 'destructive'}>
          <Icons.info className='h-4 w-4' />
          <AlertTitle>
            {data.listError.reason === 'plan'
              ? 'Limited by the current Fireflies plan'
              : 'Could not reach Fireflies'}
          </AlertTitle>
          <AlertDescription>
            {data.listError.message}
            {/* Meetings already pulled live in our own tables, so the page is
                still useful when the upstream list is unavailable. */}
            {data.meetings.length > 0 && ' — showing meetings already stored locally.'}
          </AlertDescription>
        </Alert>
      )}
      <DataTableToolbar table={table} />
    </DataTable>
  );
}
