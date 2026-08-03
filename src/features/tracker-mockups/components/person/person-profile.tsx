'use client';

import { parseAsString, useQueryState } from 'nuqs';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { MOCKUP_TODAY } from '../../constants';
import { PEOPLE, countsFor, itemsFor, personByName } from '../../fixtures';
import { OwnerAvatar } from '../owner-avatar';
import { AiSummaryCard } from './ai-summary-card';
import { PersonItemList } from './person-item-list';

/** Whoever is shown when no ?person= is supplied. Picked for a full mix. */
const DEFAULT_PERSON = 'Sami';

export function PersonProfile() {
  // nuqs, matching the repo pattern — not raw useSearchParams. `shallow` keeps
  // the switch client-side; there is no server data to refetch.
  const [selected, setSelected] = useQueryState(
    'person',
    parseAsString.withDefault(DEFAULT_PERSON).withOptions({ shallow: true })
  );

  const person = personByName(selected) ?? personByName(DEFAULT_PERSON);
  if (!person) return null;

  const items = itemsFor(person.name);
  const counts = countsFor(person.name, MOCKUP_TODAY);

  return (
    <div className='flex flex-col gap-6'>
      {/* Roster chips — presentation only. Swapping the param re-reads the same
          static fixtures, so any person can be screenshotted. */}
      <div className='flex flex-wrap items-center gap-2'>
        {PEOPLE.map((p) => {
          const active = p.name === person.name;
          return (
            <button
              key={p.name}
              type='button'
              onClick={() => void setSelected(p.name)}
              aria-pressed={active}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors',
                active
                  ? 'border-primary bg-primary/10 font-medium'
                  : 'hover:bg-muted text-muted-foreground'
              )}
            >
              <OwnerAvatar name={p.name} />
              {p.name}
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className='flex flex-col gap-6 pt-6 sm:flex-row sm:items-center'>
          <div className='flex items-center gap-4'>
            <OwnerAvatar name={person.name} size='lg' />
            <div>
              <h2 className='text-xl font-semibold'>{person.name}</h2>
              <p className='text-muted-foreground text-sm'>{person.role}</p>
            </div>
          </div>

          <Separator orientation='vertical' className='hidden h-14 sm:block' />

          <div className='grid flex-1 grid-cols-3 gap-4'>
            <Stat label='open' value={counts.open} />
            <Stat
              label='overdue'
              value={counts.overdue}
              tone={counts.overdue > 0 ? 'danger' : undefined}
            />
            <Stat label='done' value={counts.done} tone={counts.done > 0 ? 'good' : undefined} />
          </div>
        </CardContent>
      </Card>

      {/* The AI layer, above the list — see the note in ai-summary-card.tsx. */}
      <AiSummaryCard personName={person.name} />

      <Card>
        <CardContent className='pt-6'>
          <h3 className='mb-1 text-sm font-semibold'>Assigned work</h3>
          <p className='text-muted-foreground mb-2 text-xs'>
            {items.length} item{items.length === 1 ? '' : 's'} · overdue first
          </p>
          <PersonItemList items={items} />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'good' }) {
  return (
    <div className='flex flex-col'>
      <span
        className={cn(
          'font-mono text-3xl leading-none',
          tone === 'danger' && 'text-red-600 dark:text-red-400',
          tone === 'good' && 'text-emerald-600 dark:text-emerald-400',
          !tone && value === 0 && 'text-muted-foreground'
        )}
      >
        {value}
      </span>
      <span className='text-muted-foreground mt-1 text-[11px] tracking-wide uppercase'>
        {label}
      </span>
    </div>
  );
}
