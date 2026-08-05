'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { StatCard } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import type { PersonProfile } from '../api/types';
import { personAccentVar } from '../constants/profile-options';

/**
 * Header block + the three signal cards.
 *
 * Laid out to the mockup's Person profile screen: back link, 52px tinted avatar
 * beside a 20px name, a subtitle of role · department · Slack, a role-profile
 * chip, then three stat cards.
 *
 * ⚠️ Every element answers one of the three chase questions — who am I looking
 * at, what are they carrying, is anything slipping. There is deliberately no
 * "member since", no completion percentage and no sparkline: none of those
 * replace a Slack DM, which is the thing this page exists to prevent.
 *
 * ⚠️ THE ROSTER CHIP ROW WAS REMOVED. It rendered every person as a pill above
 * the header — useful when this page was the only way to reach a profile, and
 * redundant now that People & org lists the roster and the tracker links owners
 * directly. It also pushed the actual subject of the page down the screen.
 * `rosterOptions()` is still exported; nothing consumes it now.
 */
export function ProfileHeader({
  profile,
  backHref,
  backLabel
}: {
  profile: PersonProfile;
  backHref: string;
  backLabel: string;
}) {
  const { person, counts, eventStats } = profile;

  // "vision, slack" — names the sources so a low count reads as attribution
  // coverage rather than as idleness. See the note on eventStats in service.ts.
  const sourceSummary =
    eventStats.bySource.length > 0
      ? eventStats.bySource.map((s) => s.source).join(', ')
      : 'no attributed sources';

  const subtitle = [
    person.roleDisplayName ?? 'No role assigned',
    person.deptName ?? 'No department',
    person.slackHandle ? `@${person.slackHandle}` : '—'
  ].join(' · ');

  return (
    <div className='flex flex-col gap-[14px]'>
      <Link
        href={backHref}
        className='text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-[4px] text-[12px] transition-colors'
      >
        <Icons.chevronLeft className='size-[13px]' aria-hidden />
        {backLabel}
      </Link>

      <div className='flex items-start gap-[16px]'>
        {/*
          ⚠️ TINTED PER PERSON, which reverses the documented default on
          `InitialsAvatar` in @/components/ui/panel — its header argues for
          neutral avatars so colour means severity and nothing else. The mockup
          and the brief both call for a stable per-person tint matching the
          sidebar's user chip, so that default is overridden HERE ONLY; the shared
          primitive stays neutral for dense rows.

          Hashing person.ID, not their name: the primitive's other objection was
          that a hash scheme recolours someone the day a name is corrected. An id
          never changes, so that objection does not apply here.
        */}
        <span
          aria-hidden
          className='text-primary-foreground flex size-[52px] shrink-0 items-center justify-center rounded-full text-[19px] font-bold'
          style={{ backgroundColor: personAccentVar(person.id) }}
        >
          {person.initials}
        </span>

        <div className='min-w-0 flex-1'>
          <h2 className='text-[20px] leading-tight font-bold tracking-[-0.01em]'>{person.name}</h2>
          <p className='text-muted-foreground mt-[3px] truncate text-[13px]'>{subtitle}</p>
        </div>

        {/*
          ⚠️ A LINK, NOT AN ACTION. The mockup's button triggers a fabricated
          Slack ingest in the demo; doing that for real would write invented
          content into `raw_event` beside genuine deliveries, and capture is an
          inbound webhook — there is no correct way to originate one from a
          button. Navigating to the capture queue is the honest reading.
        */}
        {/*
          ⚠️ A <Link> STYLED WITH buttonVariants, not a <Button> wrapping a link.
          `ButtonPrimitive` declares `nativeButton = true`, so composing an <a>
          into it violates its contract and Base UI warns. Navigation is an
          anchor: it belongs in the accessibility tree as a link, it middle-clicks
          and it copies its URL. Only the styling is borrowed.
        */}
        <Link
          href='/dashboard/extraction'
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
        >
          Capture from Slack
        </Link>
      </div>

      <span className='text-muted-foreground w-fit rounded-[8px] border px-[8px] py-[3px] text-[12px]'>
        Role profile: {person.role ?? 'none assigned'}
      </span>

      <div className='grid gap-[14px] sm:grid-cols-3'>
        {/*
          ⚠️ Colour on exactly ONE of these, and only when non-zero. `overdue` is
          the only number here that means "act"; tinting `done` green turns the
          row into a scoreboard and makes the one number that matters compete
          with two that do not.
        */}
        <StatCard
          size='md'
          label='Open items'
          value={counts.open}
          sub={`${counts.overdue} overdue`}
          subClassName={cn(counts.overdue > 0 && 'text-destructive font-semibold')}
        />
        <StatCard size='md' label='Done' value={counts.done} sub='all time' />
        <StatCard size='md' label='Events (30d)' value={eventStats.last30d} sub={sourceSummary} />
      </div>
    </div>
  );
}
