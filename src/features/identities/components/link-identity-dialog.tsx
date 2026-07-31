'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Icons } from '@/components/icons';
import { identitySuggestionsQuery, personOptionsQuery } from '../api/queries';
import { createPersonFromIdentityMutation, linkIdentityMutation } from '../api/mutations';
import type { MatchSuggestion, UnresolvedIdentityRow } from '../api/types';

type Props = {
  identity: UnresolvedIdentityRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The human decision point.
 *
 * ⚠️ NOTHING IN HERE AUTO-APPLIES. Suggestions are ranked and each states its
 * own evidence, but every one requires a click. Name-derived suggestions carry
 * an explicit "unverified" warning because two people can share a display name,
 * and a wrong link silently attributes one person's work to another.
 */
export function LinkIdentityDialog({ identity, open, onOpenChange }: Props) {
  const [mode, setMode] = useState<'link' | 'create'>('link');
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [newName, setNewName] = useState(identity.displayName ?? identity.editorName ?? '');
  const [newEmail, setNewEmail] = useState(identity.email ?? '');

  // Fetched on open only — suggestions scan the whole roster per identity, so
  // prefetching for every table row would repeat that work N times.
  const { data: suggestionData, isLoading } = useQuery({
    ...identitySuggestionsQuery(identity.id),
    enabled: open
  });
  const { data: people = [] } = useQuery({ ...personOptionsQuery(), enabled: open });

  const link = useMutation(linkIdentityMutation);
  const createPerson = useMutation(createPersonFromIdentityMutation);
  const busy = link.isPending || createPerson.isPending;

  function done(result: { success: boolean; message?: string }) {
    if (result.success) {
      toast.success(result.message ?? 'Linked');
      onOpenChange(false);
    } else {
      toast.error(result.message ?? 'Could not link');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Link identity</DialogTitle>
          <DialogDescription className='space-y-1'>
            <span className='block'>
              <Badge variant='outline' className='mr-2 font-mono text-xs'>
                {identity.source}
              </Badge>
              <span className='font-mono text-xs break-all'>{identity.externalId}</span>
            </span>
            <span className='text-muted-foreground block text-xs'>
              {identity.email ?? 'no email sent'}
              {identity.eventCount > 0 && ` · ${identity.eventCount} event(s) will be attributed`}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className='flex gap-2'>
          <Button
            type='button'
            size='sm'
            variant={mode === 'link' ? 'default' : 'outline'}
            onClick={() => setMode('link')}
          >
            Link to existing person
          </Button>
          <Button
            type='button'
            size='sm'
            variant={mode === 'create' ? 'default' : 'outline'}
            onClick={() => setMode('create')}
          >
            Create new person
          </Button>
        </div>

        {mode === 'link' ? (
          <div className='space-y-4'>
            <section className='space-y-2'>
              <Label>Suggested matches</Label>
              {isLoading ? (
                <p className='text-muted-foreground text-sm'>Looking for candidates…</p>
              ) : suggestionData?.suggestions.length ? (
                <ul className='space-y-2'>
                  {suggestionData.suggestions.map((s) => (
                    <SuggestionRow
                      key={`${s.personId}-${s.kind}`}
                      suggestion={s}
                      disabled={busy}
                      onConfirm={() =>
                        link.mutate(
                          { identityId: identity.id, personId: s.personId },
                          { onSuccess: done }
                        )
                      }
                    />
                  ))}
                </ul>
              ) : (
                <p className='text-muted-foreground rounded-md border border-dashed p-3 text-sm'>
                  No candidates. That is expected when the source sent no email — pick someone
                  manually below, or create a new person.
                </p>
              )}
            </section>

            <section className='space-y-2'>
              <Label htmlFor='person'>Or choose anyone</Label>
              <select
                id='person'
                className='border-input bg-background w-full rounded-md border px-3 py-2 text-sm'
                value={selectedPersonId}
                onChange={(e) => setSelectedPersonId(e.target.value)}
              >
                <option value=''>Select a person…</option>
                {people.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                    {p.email ? ` — ${p.email}` : ''}
                  </option>
                ))}
              </select>
            </section>

            <DialogFooter>
              <Button variant='outline' onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                disabled={!selectedPersonId || busy}
                onClick={() =>
                  link.mutate(
                    { identityId: identity.id, personId: selectedPersonId },
                    { onSuccess: done }
                  )
                }
              >
                Link
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='new-name'>Name</Label>
              <Input
                id='new-name'
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder='Full name'
              />
              <p className='text-muted-foreground text-xs'>
                Pre-filled from the display name, which is not authoritative — check it.
              </p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='new-email'>Email (optional)</Label>
              <Input
                id='new-email'
                type='email'
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder='name@luckyfours.com'
              />
              <p className='text-muted-foreground text-xs'>
                Setting this lets identities from OTHER systems resolve to this person automatically
                — it is the only cross-system join key.
              </p>
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                disabled={!newName.trim() || busy}
                onClick={() =>
                  createPerson.mutate(
                    {
                      identityId: identity.id,
                      name: newName.trim(),
                      ...(newEmail.trim() ? { email: newEmail.trim() } : {})
                    },
                    { onSuccess: done }
                  )
                }
              >
                Create and link
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SuggestionRow({
  suggestion,
  disabled,
  onConfirm
}: {
  suggestion: MatchSuggestion;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <li className='flex items-start justify-between gap-3 rounded-md border p-3'>
      <div className='min-w-0 space-y-1'>
        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium'>{suggestion.personName}</span>
          {suggestion.verified ? (
            <Badge variant='secondary' className='text-xs'>
              email match
            </Badge>
          ) : (
            // The whole point of the design: names are a hint, not evidence.
            <Badge variant='outline' className='text-xs'>
              <Icons.warning className='mr-1 h-3 w-3' />
              unverified
            </Badge>
          )}
        </div>
        <p className='text-muted-foreground text-xs'>{suggestion.reason}</p>
      </div>
      <Button size='sm' variant='outline' disabled={disabled} onClick={onConfirm}>
        Confirm
      </Button>
    </li>
  );
}
