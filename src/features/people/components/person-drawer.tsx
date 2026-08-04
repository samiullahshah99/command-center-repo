'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/format-date';
import { personPanelOptions } from '../api/queries';
import type { PersonBoardRow } from '../api/types';

/**
 * Side panel for one person. Read-only projection — no mutations from here.
 *
 * ⚠️ DATA LOADS ON OPEN, not with the board. `enabled: open` is what keeps that
 * true: without it, mounting one drawer per row would fire seven panel queries
 * on page load, which is precisely the N+1 the board's aggregates exist to
 * avoid. The board itself fetches nothing per row.
 *
 * ⚠️ Every relative time uses the `now` the SERVER resolved and returned, not a
 * fresh clock. See formatRelativeTime.
 */
export function PersonDrawer({
  person,
  open,
  onOpenChange,
  editHref
}: {
  person: PersonBoardRow | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** The existing edit route — the drawer links to it rather than embedding a form. */
  editHref?: string;
}) {
  const { data, isPending, isError } = useQuery({
    ...personPanelOptions(person?.id ?? ''),
    enabled: open && Boolean(person?.id)
  });

  const now = data ? new Date(data.now) : new Date(0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='w-full overflow-y-auto sm:max-w-lg'>
        <SheetHeader>
          <SheetTitle className='text-xl font-medium'>{person?.name ?? ''}</SheetTitle>
          <SheetDescription>
            {person?.roleProfileName ?? 'No role profile'}
            {person?.email ? ` · ${person.email}` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className='flex flex-col gap-6 px-4 pb-6'>
          {isError && (
            <p className='text-sm text-red-600'>
              Could not load this person&apos;s detail. Close and reopen to retry.
            </p>
          )}

          {/* A skeleton, not a spinner — the panel has a known shape. */}
          {isPending && !isError && (
            <div className='flex flex-col gap-2'>
              {[0, 1, 2].map((i) => (
                <div key={i} className='bg-muted h-4 w-full animate-pulse rounded' />
              ))}
            </div>
          )}

          {data && (
            <>
              <Section title='Identities' count={data.identities.length}>
                {data.identities.length === 0 ? (
                  <Empty>
                    No linked accounts. Their work in Slack, Vision or ClickUp cannot be attributed
                    until one is linked.{' '}
                    <Link href='/dashboard/identities' className='underline'>
                      Open Identities
                    </Link>
                  </Empty>
                ) : (
                  <ul className='flex flex-col gap-2'>
                    {data.identities.map((i) => (
                      <li key={i.id} className='flex items-start justify-between gap-3 text-sm'>
                        <div className='flex min-w-0 flex-col'>
                          <span className='capitalize'>{i.source}</span>
                          {/* Truncated: the raw external id is opaque and long,
                              and no one needs to read all of it here. */}
                          <span className='text-muted-foreground truncate font-mono text-xs'>
                            {i.externalId.slice(0, 18)}
                            {i.externalId.length > 18 ? '…' : ''}
                          </span>
                          {i.email && (
                            <span className='text-muted-foreground text-xs'>{i.email}</span>
                          )}
                        </div>
                        <div className='flex shrink-0 flex-col items-end gap-1'>
                          {i.confidence && (
                            <Badge variant='outline' className='text-[11px] font-normal'>
                              {i.confidence}
                            </Badge>
                          )}
                          <span className='text-muted-foreground text-xs'>
                            {formatRelativeTime(i.linkedAt, now)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title='Recent activity' count={data.events.length}>
                {data.events.length === 0 ? (
                  <Empty>
                    No attributed events. This is expected when no accounts are linked — events are
                    stored but belong to nobody yet.
                  </Empty>
                ) : (
                  <ul className='flex flex-col gap-1.5'>
                    {data.events.map((e) => (
                      <li key={e.id} className='flex items-baseline justify-between gap-3 text-sm'>
                        <span className='min-w-0 truncate'>
                          <span className='capitalize'>{e.source}</span>
                          <span className='text-muted-foreground'> · {e.eventType}</span>
                        </span>
                        <span className='text-muted-foreground shrink-0 text-xs'>
                          {formatRelativeTime(e.occurredAt, now)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title='Pending items' count={data.items.length}>
                {data.items.length === 0 ? (
                  <Empty>Nothing awaiting review for this person.</Empty>
                ) : (
                  <ul className='flex flex-col gap-3'>
                    {data.items.map((it) => (
                      <li key={it.id} className='flex flex-col gap-1'>
                        <span className='text-sm'>{it.description}</span>
                        {/* The quote is the evidence the reviewer checks — it is
                            why source_span is mandatory and never nullable. */}
                        <blockquote className='text-muted-foreground border-l-2 pl-2 text-xs italic'>
                          {it.sourceSpan}
                        </blockquote>
                        {it.ownerConfidence && (
                          <span className='text-muted-foreground text-[11px]'>
                            owner match: {it.ownerConfidence}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}

          {/* aria-label goes on the RENDERED anchor: the a11y rules inspect the
              element inside `render` and cannot see that its text arrives as
              Button's children. Same fix as the sidebar and StatusCell. */}
          {editHref && (
            <Button
              variant='outline'
              render={<Link href={editHref} aria-label={`Edit ${person?.name ?? 'person'}`} />}
            >
              Edit person
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  count,
  children
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className='flex flex-col gap-2'>
      <h3 className='flex items-baseline gap-2 text-sm font-medium'>
        {title}
        <span className='text-muted-foreground text-xs'>{count}</span>
      </h3>
      {children}
    </section>
  );
}

/** Empty states name the reason and the next action — never just "none". */
function Empty({ children }: { children: React.ReactNode }) {
  return <p className='text-muted-foreground text-xs'>{children}</p>;
}
