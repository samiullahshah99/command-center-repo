'use client';

import Link from 'next/link';
import { useSuspenseQuery } from '@tanstack/react-query';
import { SampleDataCaption } from '@/components/sample-data-caption';
import { LABEL_CAPS, Panel, Screen } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { peopleOrgQueryOptions } from '../api/queries';
import type { OrgDeptColumn, OrgPersonChip, PeopleOrg } from '../api/types';

/**
 * People & org — the org chart, derived live from `role` and `department`.
 *
 * ⚠️ HONESTY RELABEL. The mockup's subtitle reads "Org chart seeded from Miro ·
 * live embed: luckyfours.app/embed/org". There is no Miro integration, no embed,
 * and no Miro credential — rendering that line would describe a system that does
 * not exist, on the page whose whole job is to say who works here. The chart below
 * is genuinely derived from the two tables, so the subtitle says so. See
 * docs/gaps.md.
 *
 * ⚠️ ONE surface is invented: the Recruiting card. Every chip, name, role and
 * department below is a real row.
 */
export function PeopleOrgBody() {
  const { data } = useSuspenseQuery(peopleOrgQueryOptions());

  return (
    <Screen width='narrow'>
      <div>
        <h1 className='text-[21px] leading-none font-bold tracking-[-0.01em]'>People &amp; org</h1>
        <p className='text-muted-foreground mt-[6px] max-w-[760px] text-[13px] leading-[1.5]'>
          Org chart derived live from roles and departments.
        </p>
      </div>

      <OrgCard data={data} />
      <RecruitingCard data={data} />
    </Screen>
  );
}

// ── Chips ───────────────────────────────────────────────────────────────────

/**
 * ⚠️ EVERY CHIP IS NAVIGATION — a plain `<Link>`, never a `<Button>` wrapping one.
 * `ButtonPrimitive` declares `nativeButton = true`, so composing an `<a>` into it
 * violates its contract and Base UI warns in dev.
 */
function ElevatedChip({ person, avatar }: { person: OrgPersonChip; avatar: 36 | 32 }) {
  return (
    <Link
      href={person.href}
      className='hover:bg-muted/50 flex items-center gap-[10px] rounded-[12px] border px-[14px] py-[10px] transition-colors'
    >
      <span
        aria-hidden
        className={cn(
          'text-primary-foreground flex shrink-0 items-center justify-center rounded-full font-bold',
          avatar === 36 ? 'size-[36px] text-[13px]' : 'size-[32px] text-[12px]'
        )}
        style={{ backgroundColor: person.accentVar }}
      >
        {person.initials}
      </span>
      <span className='flex min-w-0 flex-col'>
        <span className='truncate text-[13.5px] leading-tight font-bold'>{person.name}</span>
        <span className='text-muted-foreground truncate text-[11.5px]'>
          {person.roleLabel ?? 'No role assigned'}
        </span>
      </span>
    </Link>
  );
}

function DeptChip({ person }: { person: OrgPersonChip }) {
  return (
    <Link
      href={person.href}
      className='bg-card hover:ring-ring/40 flex items-center gap-[8px] rounded-[10px] border px-[9px] py-[7px] transition-shadow hover:ring-2'
    >
      <span
        aria-hidden
        className='text-primary-foreground flex size-[26px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold'
        style={{ backgroundColor: person.accentVar }}
      >
        {person.initials}
      </span>
      <span className='flex min-w-0 flex-col'>
        <span className='truncate text-[12.5px] leading-tight font-semibold'>{person.name}</span>
        <span className='text-muted-foreground truncate text-[10.5px]'>
          {person.roleLabel ?? 'No role'}
        </span>
      </span>
    </Link>
  );
}

/**
 * The 1px × 22px trunk between levels.
 *
 * ⚠️ RENDERED ONLY BETWEEN TWO LEVELS THAT BOTH EXIST. A connector hanging off
 * nothing draws a line to an absent manager, which reads as a loading failure.
 * Zero holders at a level is a real state — `person.role_id` is nullable and the
 * roster is deny-by-default — so the level collapses and takes its connector with
 * it.
 */
function Connector() {
  return <span aria-hidden className='bg-border h-[22px] w-px shrink-0' />;
}

// ── Org card ────────────────────────────────────────────────────────────────

function OrgCard({ data }: { data: PeopleOrg }) {
  // ⚠️ Levels are rendered only when populated, so the connectors have to key off
  // what actually precedes them rather than off a fixed layout.
  const hasFounders = data.founders.length > 0;
  const hasOpsLeads = data.opsLeads.length > 0;
  const hasAnyElevated = hasFounders || hasOpsLeads;

  return (
    <Panel
      title='Org chart'
      meta={<span className='text-[11.5px]'>{data.headcount} people</span>}
      // 26px card padding per the spec; tailwind-merge drops Panel's default p-[18px].
      className='p-[26px]'
      bodyClassName='flex flex-col items-center'
    >
      {hasFounders && (
        // ⚠️ SIDE BY SIDE, not a single node. Nothing makes `founder` singular —
        // co-founders are an ordinary shape and must not crash or drop anyone.
        <div className='flex flex-wrap justify-center gap-[10px]'>
          {data.founders.map((p) => (
            <ElevatedChip key={p.id} person={p} avatar={36} />
          ))}
        </div>
      )}

      {hasFounders && hasOpsLeads && <Connector />}

      {hasOpsLeads && (
        <div className='flex flex-wrap justify-center gap-[10px]'>
          {data.opsLeads.map((p) => (
            <ElevatedChip key={p.id} person={p} avatar={32} />
          ))}
        </div>
      )}

      {hasAnyElevated && data.departments.length > 0 && <Connector />}

      {data.departments.length > 0 && (
        <div className='grid w-full gap-[14px] sm:grid-cols-2 lg:grid-cols-4'>
          {data.departments.map((d) => (
            <DeptColumn key={d.id} dept={d} />
          ))}
        </div>
      )}

      {!hasAnyElevated && data.departments.length === 0 && (
        <p className='text-muted-foreground text-[12.5px]'>
          No people on the roster yet. Add someone below to see the chart.
        </p>
      )}
    </Panel>
  );
}

function DeptColumn({ dept }: { dept: OrgDeptColumn }) {
  return (
    <div className='flex flex-col gap-[9px]'>
      {/* The 3px accent cap. `accentVar` is a token reference, never a literal. */}
      <span
        aria-hidden
        className='h-[3px] w-full rounded-full'
        style={{ backgroundColor: dept.accentVar }}
      />
      <span className={cn(LABEL_CAPS, 'truncate')}>{dept.name}</span>

      {/*
        ⚠️ "Unassigned" sits in a row of real department names and would otherwise
        read as a fifth team. This line says what it actually is, and doubles as
        the ops lead's cue that these rows need a department set.
      */}
      {dept.isUnassigned && (
        <span className='text-muted-foreground -mt-[4px] text-[10.5px] italic'>
          no department set
        </span>
      )}

      {dept.members.length === 0 ? (
        /*
          ⚠️ THE COLUMN STAYS, EMPTY. This is not a defensive branch — it is the
          CURRENT state of Operations, whose only two members are the founder and
          the ops lead, both already rendered above and excluded here to avoid a
          double-render.

          Hiding the column would be worse than it looks: the chart would show
          three departments while the sidebar, the Control Tower health grid and
          the departments page all show four, and nothing would explain the
          difference. So the column renders and says where its people went.

          ⚠️ TWO DIFFERENT EMPTIES, and they must not share copy. Telling a reader
          to look above for people who do not exist sends them hunting for a
          rendering bug — see `elevatedCount` in ../api/types.ts.
        */
        <p className='text-muted-foreground text-[11px] italic'>
          {dept.elevatedCount > 0 ? 'All members shown above' : 'No members yet'}
        </p>
      ) : (
        <div className='flex flex-col gap-[7px]'>
          {dept.members.map((p) => (
            <DeptChip key={p.id} person={p} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Recruiting ──────────────────────────────────────────────────────────────

/**
 * ⚠️ THE ONE INVENTED SURFACE ON THIS PAGE. There is no recruiting model and no
 * ATS integration — see the note on `sampleOpenRoles` in ../api/service.ts. The
 * caption renders from the DTO's own flag, so it disappears on its own when a
 * real source lands.
 */
function RecruitingCard({ data }: { data: PeopleOrg }) {
  return (
    <Panel title='Recruiting'>
      {data.recruitingIsSample && (
        <SampleDataCaption what='no recruiting model or ATS is connected — these vacancies are illustrative.' />
      )}

      {data.openRoles.length === 0 ? (
        <p className='text-muted-foreground text-[12.5px]'>No open roles.</p>
      ) : (
        <div className='divide-y'>
          {data.openRoles.map((r) => (
            <p key={r.id} className='py-[8px] text-[12.5px] first:pt-0 last:pb-0'>
              <span className='font-semibold'>{r.title}</span>
              <span className='text-muted-foreground'>
                {' · '}
                {r.employmentType}
                {' · '}
                {r.stage}
              </span>
            </p>
          ))}
        </div>
      )}
    </Panel>
  );
}
