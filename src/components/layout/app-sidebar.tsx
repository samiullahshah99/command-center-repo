'use client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
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
import { UserAvatarProfile } from '@/components/user-avatar-profile';
import { navGroups } from '@/config/nav-config';
import { NavBadge, useNavBadges } from './nav-badge';
import type { NavGroup, NavItem } from '@/types';
import { useMediaQuery } from '@/hooks/use-media-query';
import { SignOutButton, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { Icons } from '../icons';

export default function AppSidebar() {
  const pathname = usePathname();
  const { isOpen } = useMediaQuery();
  const { user } = useUser();
  const router = useRouter();

  React.useEffect(() => {
    // Side effects based on sidebar state changes
  }, [isOpen]);

  return (
    <Sidebar collapsible='icon'>
      <SidebarHeader className='group-data-[collapsible=icon]:pt-4'>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size='lg'
              render={<Link href='/dashboard/overview' aria-label='Dashboard home' />}
            >
              {/* 30px tile, 8px radius, --sidebar-primary — mock's header block. */}
              <div className='bg-sidebar-primary text-sidebar-primary-foreground flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-[13px] font-bold'>
                <Icons.logo className='size-4' />
              </div>
              <div className='grid flex-1 text-left leading-tight'>
                <span className='truncate text-[13.5px] font-bold'>Command Center</span>
                {/* Subtitle hides when the rail collapses to icons — at 48px
                    there is no room for it and it would wrap under the tile. */}
                <span className='text-muted-foreground truncate text-[11px] group-data-[collapsible=icon]:hidden'>
                  Lucky Fours · internal
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className='overflow-x-hidden'>
        {navGroups.map((group) => (
          <NavZone key={group.id} group={group} pathname={pathname} />
        ))}
      </SidebarContent>
      {/* Top border per the mock. The user block below is the REAL Clerk
          session — name and email from useUser(), never a hardcoded person. */}
      <SidebarFooter className='border-sidebar-border border-t'>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size='lg'
                    className='data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground'
                  />
                }
              >
                {user && (
                  <UserAvatarProfile className='size-[30px] rounded-full' showInfo user={user} />
                )}
                <Icons.chevronsDown className='ml-auto size-4' />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className='w-(--anchor-width) min-w-56 rounded-lg'
                side='bottom'
                align='end'
                sideOffset={4}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className='p-0 font-normal'>
                    <div className='px-1 py-1.5'>
                      {user && (
                        <UserAvatarProfile className='h-8 w-8 rounded-lg' showInfo user={user} />
                      )}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />

                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => router.push('/dashboard/profile')}>
                    <Icons.account className='mr-2 h-4 w-4' />
                    Profile
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Icons.logout className='mr-2 h-4 w-4' />
                  <SignOutButton redirectUrl='/auth/sign-in' />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/**
 * One nav section. Collapsible when `defaultOpen === false`.
 *
 * ⚠️ COLLAPSIBLE GROUPS ARE SUPPORTED, via the existing `Collapsible` primitive
 * wrapping a `SidebarGroup` — no new component was needed.
 *
 * ⚠️ `SidebarGroupLabel` MUST render as a native <button> here. It defaults to a
 * <div>, and base-ui's Collapsible.Trigger defaults `nativeButton` to true, so
 * composing the trigger onto a div throws "A component that acts as a button
 * expected a native <button>" and silently drops native button semantics for
 * forms and assistive tech. `type='button'` is separate and also required: an
 * unspecified <button> defaults to type="submit".
 */
function NavZone({ group, pathname }: { group: NavGroup; pathname: string }) {
  const rows = (
    <SidebarMenu>
      {group.items.map((item) => (
        <NavRow key={item.title} item={item} pathname={pathname} />
      ))}
    </SidebarMenu>
  );

  if (group.defaultOpen === false) {
    return (
      <SidebarGroup className='py-0'>
        <Collapsible defaultOpen={false} className='group/zone'>
          <CollapsibleTrigger
            render={
              <SidebarGroupLabel
                render={
                  // aria-label on the RENDERED button: the a11y rule inspects the
                  // element inside `render` and cannot see that its text arrives
                  // as CollapsibleTrigger's children.
                  <button type='button' aria-label={`${group.label} section, expand or collapse`} />
                }
                className='text-muted-foreground text-[11px] font-semibold tracking-[0.07em] uppercase w-full cursor-pointer'
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
    <SidebarGroup className='py-0'>
      {group.label && (
        <SidebarGroupLabel className='text-muted-foreground text-[11px] font-semibold tracking-[0.07em] uppercase'>
          {group.label}
        </SidebarGroupLabel>
      )}
      {rows}
    </SidebarGroup>
  );
}

function NavRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon ? Icons[item.icon] : Icons.logo;
  // Shares ONE cache entry across every badge on the rail — see useNavBadges.
  const { data: badges } = useNavBadges();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={item.url} aria-label={item.title} />}
        tooltip={item.title}
        isActive={pathname === item.url}
        /* Mock's row spec. Arbitrary values on radius/size deliberately:
           tailwind-merge does not treat `rounded-cc-*`-style scale names as the
           same group as `rounded-md`, but `rounded-[8px]` IS in that group and
           correctly evicts the cva's default. Active state is --sidebar-accent,
           which is exactly the mock's towerBg (`view === v ? sidebar-accent`),
           so hover and active intentionally match. */
        className='rounded-[8px] text-[13.5px] font-medium [&>svg]:size-[15px]'
      >
        <Icon />
        <span>{item.title}</span>
        {item.badge && <NavBadge count={badges?.[item.badge]} />}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
