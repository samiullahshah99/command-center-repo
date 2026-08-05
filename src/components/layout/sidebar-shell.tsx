'use client';

/**
 * App sidebar — the CLIENT half.
 *
 * Receives already-filtered nav groups and already-computed department health as
 * plain props from ./app-sidebar.tsx. It owns only what genuinely needs the
 * browser: the active row (`usePathname`) and Clerk `signOut`.
 *
 * ⚠️ NEVER import `@/lib/dept-nav`, `@/lib/current-actor` or `@/db` here. All
 * three pull in `pg`, and a client import fails the build with seven Turbopack
 * errors naming `dns`/`net`/`tls`/`fs` inside pg internals — none of which names
 * the import that caused it. `pnpm lint:boundaries` guards this file.
 */

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { DeptNavRow } from '@/lib/dept-nav';
import type { DeptHealthStatus } from '@/lib/dept-health';
import type { NavGroup, NavItem } from '@/types';
import { useClerk } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { Icons } from '../icons';
import { NavBadge, useNavBadges } from './nav-badge';

/** Section label style, shared by every section per the mockup. */
const SECTION_LABEL = 'text-muted-foreground text-[11px] font-semibold tracking-[0.07em] uppercase';

/** Row style, shared by nav rows and department rows. */
const ROW =
  'rounded-[8px] text-[13.5px] font-medium [&>svg]:size-[15px] hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent';

/**
 * Health dot colour.
 *
 * ⚠️ SEMANTIC TOKENS ONLY. `--success` / `--warning` / `--destructive` all exist
 * in both modes; the emerald/amber literals these replace were the exact bug the
 * semantic-status tokens were added to fix — they rendered light surfaces in dark
 * mode. Never reintroduce a palette class here.
 */
const HEALTH_DOT: Record<DeptHealthStatus, string> = {
  good: 'bg-success',
  needs_attention: 'bg-warning',
  bad: 'bg-destructive'
};

const HEALTH_LABEL: Record<DeptHealthStatus, string> = {
  good: 'Healthy',
  needs_attention: 'Needs attention',
  bad: 'At risk'
};

export type SidebarUser = {
  name: string | null;
  roleLabel: string | null;
  email: string | null;
};

export function SidebarShell({
  groups,
  departments,
  user
}: {
  groups: NavGroup[];
  departments: DeptNavRow[];
  user: SidebarUser;
}) {
  const pathname = usePathname();

  return (
    // Fixed 240px per the mockup, via the primitive's own width variable so the
    // inset content offset stays in sync. Padding 14px 10px.
    <Sidebar collapsible='icon' style={{ '--sidebar-width': '240px' } as React.CSSProperties}>
      <SidebarHeader className='px-[10px] pt-[6px] pb-[16px]'>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size='lg'
              className='hover:bg-sidebar-accent'
              render={<Link href='/dashboard/overview' aria-label='Command Center home' />}
            >
              {/* 30px square, radius 8, --sidebar-primary, bold "CC". */}
              <div className='bg-sidebar-primary text-sidebar-primary-foreground flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-[12px] font-bold'>
                CC
              </div>
              <div className='grid flex-1 text-left leading-tight'>
                <span className='text-sidebar-foreground truncate text-[13.5px] font-bold'>
                  Command Center
                </span>
                {/* Hidden when the rail collapses to 48px, where it would wrap
                    under the tile. */}
                <span className='text-muted-foreground truncate text-[11px] group-data-[collapsible=icon]:hidden'>
                  Lucky Fours · internal
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className='overflow-x-hidden px-0'>
        {groups.map((group) =>
          group.id === 'company' ? (
            <React.Fragment key={group.id}>
              {/* Departments sits between Workspace and Company per the mockup.
                  Rendered here rather than as a config group because its rows
                  come from the database, not from nav-config. */}
              <DepartmentsSection departments={departments} pathname={pathname} />
              <NavSection group={group} pathname={pathname} />
            </React.Fragment>
          ) : (
            <NavSection key={group.id} group={group} pathname={pathname} />
          )
        )}
        {/* No Company group (role gate removed it) but departments still allowed. */}
        {!groups.some((g) => g.id === 'company') && departments.length > 0 && (
          <DepartmentsSection departments={departments} pathname={pathname} />
        )}
      </SidebarContent>

      {/* SPACER is SidebarContent's flex:1; the chip sits above the bottom with a
          top border, per the mockup. */}
      <SidebarFooter className='border-sidebar-border border-t px-[10px] py-[10px]'>
        <UserChip user={user} />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

/**
 * One nav section. Collapsible only when the group asks for it.
 *
 * ⚠️ `SidebarGroupLabel` MUST render a native <button> inside a Collapsible:
 * it defaults to a <div>, and base-ui's Collapsible.Trigger defaults
 * `nativeButton` to true, so composing onto a div throws "A component that acts
 * as a button expected a native <button>". `type='button'` is separately
 * required — an unspecified <button> defaults to submit.
 */
function NavSection({ group, pathname }: { group: NavGroup; pathname: string }) {
  const rows = (
    <SidebarMenu>
      {group.items.map((item) => (
        <NavRow key={item.title} item={item} pathname={pathname} />
      ))}
    </SidebarMenu>
  );

  if (group.defaultOpen === false) {
    return (
      <SidebarGroup className='px-[10px] py-0'>
        <Collapsible defaultOpen={false} className='group/zone'>
          <CollapsibleTrigger
            render={
              <SidebarGroupLabel
                render={
                  <button type='button' aria-label={`${group.label} section, expand or collapse`} />
                }
                className={cn(SECTION_LABEL, 'w-full cursor-pointer')}
              />
            }
          >
            {group.label}
            <Icons.chevronRight className='ml-auto size-3.5 transition-transform duration-200 group-data-panel-open/zone:rotate-90' />
          </CollapsibleTrigger>
          <CollapsibleContent>{rows}</CollapsibleContent>
        </Collapsible>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup className='px-[10px] py-0'>
      <SidebarGroupLabel className={SECTION_LABEL}>{group.label}</SidebarGroupLabel>
      {rows}
    </SidebarGroup>
  );
}

function NavRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon ? Icons[item.icon] : Icons.circle;
  // One shared cache entry across every badge on the rail — see useNavBadges.
  const { data: badges } = useNavBadges();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={item.url} aria-label={item.title} />}
        tooltip={item.title}
        isActive={pathname === item.url}
        className={cn(ROW, 'px-[10px] py-[7px]')}
      >
        <Icon />
        <span>{item.title}</span>
        {item.badge && <NavBadge count={badges?.[item.badge]} />}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Departments — one row per database row.
 *
 * ⚠️ Renders NOTHING when the list is empty rather than an empty section. Before
 * migration 0011 is applied and the seed has run there are no departments, and a
 * bare "DEPARTMENTS" label with no rows under it reads as a failed load.
 */
function DepartmentsSection({
  departments,
  pathname
}: {
  departments: DeptNavRow[];
  pathname: string;
}) {
  if (departments.length === 0) return null;

  return (
    <SidebarGroup className='px-[10px] py-0'>
      <SidebarGroupLabel className={SECTION_LABEL}>Departments</SidebarGroupLabel>
      <SidebarMenu>
        {departments.map((d) => {
          const url = `/dashboard/departments/${d.id}`;
          return (
            <SidebarMenuItem key={d.id}>
              <SidebarMenuButton
                render={<Link href={url} aria-label={`${d.name} department`} />}
                tooltip={d.name}
                isActive={pathname === url}
                className={cn(ROW, 'px-[10px] py-[7px]')}
              >
                {/* 8px accent dot. Inline style because the value is a theme
                    token reference resolved per department — see
                    @/lib/dept-accent. Not a colour literal. */}
                <span
                  aria-hidden
                  className='size-[8px] shrink-0 rounded-full'
                  style={{ backgroundColor: d.accentVar }}
                />
                <span className='flex-1 truncate'>{d.name}</span>
                {/* 7px health dot. The reasons come from computeDeptHealth and
                    are the tooltip, so a red dot always explains itself. */}
                <span
                  className={cn(
                    'size-[7px] shrink-0 rounded-full group-data-[collapsible=icon]:hidden',
                    HEALTH_DOT[d.health]
                  )}
                  title={
                    d.healthReasons.length > 0
                      ? `${HEALTH_LABEL[d.health]} — ${d.healthReasons.join('; ')}`
                      : `${HEALTH_LABEL[d.health]} — ${d.activeItems} active item${d.activeItems === 1 ? '' : 's'}`
                  }
                  aria-label={`${d.name}: ${HEALTH_LABEL[d.health]}`}
                  role='img'
                />
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/** Initials for the avatar. Same shape as the tracker's helper. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Stable avatar tint, by the same reasoning as the department accent: a theme
 * token reference derived from the name, so it survives a reload and a theme
 * switch. Duplicating the hash here rather than importing dept-accent keeps the
 * two independent — a person is not a department and their palettes may diverge.
 */
function avatarTint(seed: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `var(--chart-${(hash % 5) + 1})`;
}

/**
 * The user chip.
 *
 * ⚠️ SIGN OUT ACTUALLY WORKS HERE. CLAUDE.md records that the old
 * `nav-user.tsx` dropdown rendered a "Log out" item with no handler — it looked
 * complete and did nothing. This calls Clerk's `signOut` with an explicit
 * redirect, and it is a real <button>, so keyboard and assistive tech reach it.
 *
 * ⚠️ Falls back to the Clerk email, then to a placeholder, when the actor is not
 * linked to a roster person. That is a normal state (signed in, not yet on the
 * roster) and must not render an empty chip — an empty chip reads as a broken
 * session, which is the one thing it is not.
 */
function UserChip({ user }: { user: SidebarUser }) {
  const { signOut } = useClerk();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const displayName = user.name ?? user.email ?? 'Signed in';
  const displayRole = user.roleLabel ?? 'No role assigned';

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut({ redirectUrl: '/auth/sign-in' });
    } catch {
      // A failed sign-out must not leave the button spinning forever. Falling
      // back to a client navigation still gets the person off the page.
      setBusy(false);
      router.push('/auth/sign-in');
    }
  }

  return (
    <div className='flex items-center gap-[8px]'>
      <span
        aria-hidden
        className='text-primary-foreground flex size-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold'
        style={{ backgroundColor: avatarTint(displayName) }}
      >
        {initialsOf(displayName)}
      </span>
      <div className='grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden'>
        <span className='text-sidebar-foreground truncate text-[13px] font-semibold'>
          {displayName}
        </span>
        <span className='text-muted-foreground truncate text-[11px]'>{displayRole}</span>
      </div>
      <button
        type='button'
        onClick={handleSignOut}
        disabled={busy}
        aria-label='Sign out'
        title='Sign out'
        className='hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground flex size-[28px] shrink-0 items-center justify-center rounded-[8px] transition-colors disabled:opacity-50 group-data-[collapsible=icon]:hidden'
      >
        {busy ? (
          <Icons.spinner className='size-4 animate-spin' />
        ) : (
          <Icons.logout className='size-4' />
        )}
      </button>
    </div>
  );
}
