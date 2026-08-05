'use client';

import Link from 'next/link';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { StatCard } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { rosterOptions } from '../api/queries';
import type { PersonProfile } from '../api/types';

/**
 * Header + counters + cross-navigation.
 *
 * Laid out to the Person profile screen of
 * `docs/design-reference/Command_Center_dc.html`: back link, 52px avatar beside a
 * 20px name, an inline role-profile chip, then three signal cards.
 *
 * ⚠️ Every element here answers one of the three chase questions:
 *   name/role/avatar  — who am I looking at
 *   open              — what are they carrying
 *   overdue           — is anything slipping
 *   done              — what have they moved
 * Nothing else earns a place. There is no "member since", no activity sparkline,
 * no completion percentage — none of those replace a Slack DM.
 *
 * ⚠️ THE MOCK'S "CAPTURE FROM SLACK" BUTTON IS NOT BUILT. It triggers a
 * fabricated Slack ingest in the demo. Real capture is an inbound webhook, and a
 * button that manufactures a message would write invented content into
 * `raw_event` alongside real deliveries.
 */
export function ProfileHeader({ profile }: { profile: PersonProfile }) {
  const { data: roster } = useSuspenseQuery(rosterOptions());
  const { person, counts } = profile;

  return (
    <div className='flex flex-col gap-[14px]'>
      {/* Cross-navigation by real route, not chips over one page — the profile
          has a [personId] URL, so each person is linkable and shareable. */}
      <div className='flex flex-wrap items-center gap-[6px]'>
        {roster.map((r) => {
          const active = r.id === person.id;
          return (
            <Link
              key={r.id}
              href={`/dashboard/people/${r.id}/profile`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-[6px] rounded-full border px-[8px] py-[3px] text-[11.5px] transition-colors',
                active
                  ? 'border-primary bg-primary/10 font-semibold'
                  : 'hover:bg-muted text-muted-foreground'
              )}
            >
              <Avatar className='size-[18px]'>
                <AvatarFallback className='text-[9px]'>{r.initials}</AvatarFallback>
              </Avatar>
              {r.name}
            </Link>
          );
        })}
      </div>

      <div className='flex items-center gap-[16px]'>
        <Avatar className='size-[52px]'>
          <AvatarFallback className='text-[19px] font-bold'>{person.initials}</AvatarFallback>
        </Avatar>
        <div className='min-w-0 flex-1'>
          <h2 className='text-[20px] font-bold tracking-[-0.01em]'>{person.name}</h2>
          <p className='text-muted-foreground mt-[2px] text-[13px]'>
            {person.role ?? 'No role profile assigned'}
          </p>
        </div>
        <Link
          href={`/dashboard/people/${person.id}`}
          className='text-muted-foreground hover:text-foreground shrink-0 rounded-[8px] border px-[12px] py-[7px] text-[12px] transition-colors'
        >
          Edit person record →
        </Link>
      </div>

      <div className='grid gap-[14px] sm:grid-cols-3'>
        {/*
          ⚠️ Colour on exactly one of these three, and only when it is non-zero.
          `overdue` is the only counter that means "act"; tinting `done` green
          turns the row into a scoreboard and makes the one number that matters
          compete with two that do not.
        */}
        <StatCard size='md' label='open' value={counts.open} />
        <StatCard
          size='md'
          label='overdue'
          value={
            <span className={cn(counts.overdue > 0 && 'text-destructive')}>{counts.overdue}</span>
          }
        />
        <StatCard size='md' label='done' value={counts.done} />
      </div>
    </div>
  );
}
