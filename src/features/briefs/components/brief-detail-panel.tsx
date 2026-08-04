'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format-date';
import { briefTimelineOptions } from '../api/queries';

/**
 * Full event timeline for one brief.
 *
 * ⚠️ NO LINK OUT. Vision's payloads carry no URL for a brief — verified against
 * the stored envelope, which has `subject: { type, id, label }` and nothing
 * else. Constructing one from the id would be guessing at Vision's routing, and
 * a link that 404s is worse than no link. Add it when the payload carries it.
 *
 * ⚠️ Loads on OPEN (`enabled: open`), not with the board. Seventeen panels
 * mounted eagerly would be seventeen timeline queries on page load.
 */

/** Human phrasing per event type. Unknown types fall back to the raw value. */
const EVENT_VERB: Record<string, string> = {
  'brief.created': 'created the brief',
  'brief.updated': 'edited',
  'brief.submitted': 'submitted for review',
  'brief.sent_back': 'sent back',
  'brief.approved': 'approved',
  'brief.commented': 'commented',
  'brief.script_saved': 'saved the script'
};

/** Lifecycle events are the ones that MOVED the brief — visually weightier. */
const LIFECYCLE = new Set([
  'brief.created',
  'brief.updated',
  'brief.submitted',
  'brief.sent_back',
  'brief.approved'
]);

export function BriefDetailPanel({
  briefId,
  open,
  onOpenChange
}: {
  briefId: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { data, isPending, isError } = useQuery({
    ...briefTimelineOptions(briefId ?? ''),
    enabled: open && Boolean(briefId)
  });

  const now = data ? new Date(data.now) : new Date(0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='w-full overflow-y-auto sm:max-w-lg'>
        <SheetHeader>
          <SheetTitle className='text-lg font-medium'>{data?.label ?? 'Brief'}</SheetTitle>
          <SheetDescription className='font-mono text-xs'>{briefId}</SheetDescription>
        </SheetHeader>

        <div className='flex flex-col gap-4 px-4 pb-6'>
          {isError && (
            <p className='text-sm text-red-600'>
              Could not load this timeline. Close and reopen to retry.
            </p>
          )}

          {isPending && !isError && (
            <div className='flex flex-col gap-2'>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className='bg-muted h-4 w-full animate-pulse rounded' />
              ))}
            </div>
          )}

          {data && (
            <>
              <p className='text-muted-foreground text-xs'>
                {data.entries.length} events · newest first
              </p>
              <ol className='flex flex-col gap-3'>
                {data.entries.map((e) => (
                  <li key={e.id} className='flex gap-3'>
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 size-1.5 shrink-0 rounded-full',
                        LIFECYCLE.has(e.eventType) ? 'bg-slate-500' : 'bg-slate-300'
                      )}
                    />
                    <div className='flex min-w-0 flex-col gap-0.5'>
                      <span className='text-sm'>
                        <span className='font-medium'>{e.actor?.name ?? 'Someone'}</span>{' '}
                        {EVENT_VERB[e.eventType] ?? e.eventType}
                        {/* metadata.fields[] → "edited: voiceover, hook" */}
                        {e.fields.length > 0 && (
                          <span className='text-muted-foreground'>: {e.fields.join(', ')}</span>
                        )}
                      </span>
                      <span className='text-muted-foreground text-[11px]'>
                        {formatRelativeTime(e.occurredAt, now)}
                        {e.actor && !e.actor.linked && (
                          <Badge
                            variant='outline'
                            className='ml-2 px-1 py-0 text-[10px] font-normal'
                            title='Vision account not linked to a person — name is display-only'
                          >
                            unlinked
                          </Badge>
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
