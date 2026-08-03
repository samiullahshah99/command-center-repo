'use client';

import Link from 'next/link';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { rosterOptions } from '../api/queries';
import type { PersonProfile } from '../api/types';

/**
 * Header + counters + cross-navigation.
 *
 * ⚠️ Every element here answers one of the three chase questions:
 *   name/role/avatar  — who am I looking at
 *   open              — what are they carrying
 *   overdue           — is anything slipping
 *   done              — what have they moved
 * Nothing else earns a place. There is no "member since", no activity sparkline,
 * no completion percentage — none of those replace a Slack DM.
 */
export function ProfileHeader({ profile }: { profile: PersonProfile }) {
  const { data: roster } = useSuspenseQuery(rosterOptions());
  const { person, counts } = profile;

  return (
    <div className='flex flex-col gap-4'>
      {/* Cross-navigation by real route, not chips over one page — the profile
          has a [personId] URL, so each person is linkable and shareable. */}
      <div className='flex flex-wrap items-center gap-2'>
        {roster.map((r) => {
          const active = r.id === person.id;
          return (
            <Link
              key={r.id}
              href={`/dashboard/people/${r.id}/profile`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors',
                active
                  ? 'border-primary bg-primary/10 font-medium'
                  : 'hover:bg-muted text-muted-foreground'
              )}
            >
              <Avatar className='size-5'>
                <AvatarFallback className='text-[9px]'>{r.initials}</AvatarFallback>
              </Avatar>
              {r.name}
            </Link>
          );
        })}
      </div>

      <Card>
        <CardContent className='flex flex-col gap-6 pt-6 sm:flex-row sm:items-center'>
          <div className='flex items-center gap-4'>
            <Avatar className='size-14'>
              <AvatarFallback className='text-lg font-medium'>{person.initials}</AvatarFallback>
            </Avatar>
            <div>
              <h2 className='text-xl font-semibold'>{person.name}</h2>
              <p className='text-muted-foreground text-sm'>
                {person.role ?? 'No role profile assigned'}
              </p>
              <Link
                href={`/dashboard/people/${person.id}`}
                className='text-muted-foreground/80 text-xs hover:underline'
              >
                Edit person record →
              </Link>
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
