'use client';

import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { IDENTITY_SOURCES } from '@/db/schema';
import { identitiesForPersonQuery } from '../api/queries';
import { unlinkIdentityMutation } from '../api/mutations';
import { CONFIDENCE_LABELS } from '../constants/identity-options';
import type { LinkedIdentityRow } from '../api/types';

/**
 * Every external account belonging to one person, across all five sources.
 *
 * Shows `linked_by` / `linked_at` inline rather than tucking them away: the
 * PRD's evidence-based-state requirement means "who decided this, and when" has
 * to be answerable at a glance, not by querying the table.
 */
export function PersonIdentitiesCard({ personId }: { personId: string }) {
  const { data: identities = [], isLoading } = useQuery(identitiesForPersonQuery(personId));
  const unlink = useMutation(unlinkIdentityMutation);

  const bySource = new Map(identities.map((i) => [i.source, i]));
  const missing = IDENTITY_SOURCES.filter((s) => s !== 'portal' && !bySource.has(s));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked identities</CardTitle>
        <CardDescription>
          External accounts attributed to this person. Unlinking returns the account to the
          identities queue; it does not remove events already attributed.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {isLoading ? (
          <p className='text-muted-foreground text-sm'>Loading…</p>
        ) : identities.length === 0 ? (
          <p className='text-muted-foreground rounded-md border border-dashed p-4 text-sm'>
            No linked identities yet. Accounts appear here once they are linked from{' '}
            <Link href='/dashboard/identities' className='underline'>
              Identities
            </Link>
            .
          </p>
        ) : (
          <ul className='space-y-2'>
            {identities.map((identity) => (
              <IdentityRow
                key={identity.id}
                identity={identity}
                disabled={unlink.isPending}
                onUnlink={() =>
                  unlink.mutate(
                    { identityId: identity.id },
                    {
                      onSuccess: (r) =>
                        r.success
                          ? toast.success(r.message ?? 'Unlinked')
                          : toast.error(r.message ?? 'Could not unlink')
                    }
                  )
                }
              />
            ))}
          </ul>
        )}

        {missing.length > 0 && (
          // Absence is information: it says where this person's activity is not
          // being captured yet.
          <p className='text-muted-foreground text-xs'>
            No account linked for: {missing.join(', ')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function IdentityRow({
  identity,
  disabled,
  onUnlink
}: {
  identity: LinkedIdentityRow;
  disabled: boolean;
  onUnlink: () => void;
}) {
  const confidence = identity.confidence ? CONFIDENCE_LABELS[identity.confidence] : null;

  return (
    <li className='flex items-start justify-between gap-3 rounded-md border p-3'>
      <div className='min-w-0 space-y-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='outline' className='font-mono text-xs'>
            {identity.source}
          </Badge>
          <span className='font-mono text-xs break-all'>{identity.externalId}</span>
          {confidence && (
            <Badge
              variant={identity.confidence === 'manual' ? 'default' : 'secondary'}
              className='text-xs'
              title={confidence.hint}
            >
              {confidence.label}
            </Badge>
          )}
          {identity.eventCount > 0 && (
            <span className='text-muted-foreground text-xs tabular-nums'>
              {identity.eventCount} event{identity.eventCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p className='text-muted-foreground text-xs'>
          {identity.email ?? 'no email sent'}
          {identity.displayName ? ` · ${identity.displayName}` : ''}
        </p>
        {/* The audit trail. A null linkedBy means it matched automatically. */}
        <p className='text-muted-foreground text-xs'>
          {identity.linkedBy
            ? `Linked by ${identity.linkedBy}`
            : 'Linked automatically by email match'}
          {identity.linkedAt ? ` · ${new Date(identity.linkedAt).toLocaleString()}` : ''}
        </p>
      </div>
      <Button size='sm' variant='ghost' disabled={disabled} onClick={onUnlink}>
        <Icons.close className='mr-1 h-4 w-4' />
        Unlink
      </Button>
    </li>
  );
}
