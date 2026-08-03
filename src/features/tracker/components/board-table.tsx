'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { boardQueryOptions } from '../api/queries';
import {
  externalUrlFor,
  isTerminal,
  SOURCE_SYSTEM_LABEL,
  STATUS_META
} from '../constants/tracker-options';
import type { BoardGroup } from '../api/types';
import { InlineDueDate } from './inline-due-date';
import { InlineOwnerSelect } from './inline-owner-select';
import { InlineStatusSelect } from './inline-status-select';
import { PersonBadge } from './person-badge';

export function BoardTable({ projectId }: { projectId: string }) {
  const { data } = useSuspenseQuery(boardQueryOptions(projectId));

  /**
   * ⚠️ "Now" resolved ONCE, here, and threaded down.
   *
   * Every overdue check in this subtree uses this value. Calling `new Date()`
   * per row would compare against a different instant on the server than in the
   * browser, and a row sitting on the boundary would render "overdue" on one
   * side only — a hydration mismatch that blanks the table. useMemo with an
   * empty dep list pins it for the life of the mount.
   */
  const now = useMemo(() => new Date(), []);

  if (!data) return null;

  return (
    <div className='flex flex-col gap-6'>
      {data.groups.map((group) => (
        <StatusGroup
          key={group.status}
          group={group}
          projectId={projectId}
          roster={data.roster}
          now={now}
        />
      ))}

      {data.totalCount === 0 && (
        <Card>
          <CardContent className='text-muted-foreground py-12 text-center text-sm'>
            No items in this project yet.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusGroup({
  group,
  projectId,
  roster,
  now
}: {
  group: BoardGroup;
  projectId: string;
  roster: { id: string; name: string; initials: string }[];
  now: Date;
}) {
  const meta = STATUS_META[group.status];
  const terminal = isTerminal(group.status);

  return (
    <section>
      {/* Monday-style lane header: a coloured rule plus a count, always shown
          even when the lane is empty so the board's shape stays stable. */}
      <div className='mb-2 flex items-center gap-2'>
        <span className={cn('size-2.5 rounded-full', meta.dot)} />
        <h2 className='text-sm font-semibold'>{meta.label}</h2>
        <span className='text-muted-foreground text-xs'>{group.items.length}</span>
      </div>

      <div className='overflow-hidden rounded-lg border'>
        <Table>
          <TableHeader className='bg-muted/50'>
            <TableRow>
              <TableHead className='w-[42%]'>Task</TableHead>
              <TableHead className='w-[190px]'>Owner</TableHead>
              <TableHead className='w-[170px]'>Due</TableHead>
              <TableHead className='w-[150px]'>Status</TableHead>
              <TableHead>Origin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className='text-muted-foreground h-16 text-center text-sm'>
                  Nothing {meta.label.toLowerCase()}
                </TableCell>
              </TableRow>
            ) : (
              group.items.map((item) => {
                const url = externalUrlFor(item.sourceSystem, item.externalTaskId);
                return (
                  <TableRow key={item.id} className={cn(terminal && 'opacity-60')}>
                    <TableCell>
                      <div className='flex items-start gap-2'>
                        {item.riskFlag && (
                          <Icons.alertCircle
                            className='mt-0.5 size-4 shrink-0 text-red-500'
                            aria-label='At risk'
                          />
                        )}
                        <div className='flex flex-col'>
                          <span className={cn('text-sm', terminal && 'line-through')}>
                            {/* A clickup/notion-sourced row has NULL title by
                                CHECK constraint — its content lives in the
                                source system and is read through, not cached. */}
                            {item.title ?? (
                              <span className='text-muted-foreground italic'>
                                title held in {SOURCE_SYSTEM_LABEL[item.sourceSystem]}
                              </span>
                            )}
                          </span>
                          {item.description && (
                            <span className='text-muted-foreground line-clamp-1 text-xs'>
                              {item.description}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className='flex flex-col gap-1'>
                        <InlineOwnerSelect
                          itemId={item.id}
                          projectId={projectId}
                          value={item.owner}
                          roster={roster}
                        />
                        {/* The uncertainty marker sits under the editor rather
                            than inside it — a Select cannot carry an icon
                            without fighting its own value rendering. */}
                        {item.originOwnerConfidence && (
                          <PersonBadge
                            person={item.owner}
                            originOwnerConfidence={item.originOwnerConfidence}
                            className='pl-1'
                          />
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      <InlineDueDate
                        itemId={item.id}
                        projectId={projectId}
                        value={item.dueDate}
                        terminal={terminal}
                        now={now}
                      />
                    </TableCell>

                    <TableCell>
                      <InlineStatusSelect
                        itemId={item.id}
                        projectId={projectId}
                        value={item.status}
                      />
                    </TableCell>

                    <TableCell>
                      <Badge variant='outline' className='text-xs font-normal'>
                        {SOURCE_SYSTEM_LABEL[item.sourceSystem]}
                      </Badge>
                      {url && (
                        <Link
                          href={url}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='text-muted-foreground ml-2 inline-flex items-center hover:underline'
                        >
                          <Icons.externalLink className='size-3.5' />
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
