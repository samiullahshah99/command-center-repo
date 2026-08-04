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
              <div className='bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg'>
                <Icons.logo className='size-4' />
              </div>
              <div className='grid flex-1 text-left text-sm leading-tight'>
                <span className='truncate font-semibold'>Dashboard</span>
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
      <SidebarFooter>
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
                {user && <UserAvatarProfile className='h-8 w-8 rounded-lg' showInfo user={user} />}
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
                className='w-full cursor-pointer'
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
      {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
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
      >
        <Icon />
        <span>{item.title}</span>
        {item.badge && <NavBadge count={badges?.[item.badge]} />}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
