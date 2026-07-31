import { NavGroup } from '@/types';

/**
 * Navigation configuration
 *
 * This configuration is used for both the sidebar navigation and Cmd+K bar.
 * Items are organized into groups, each rendered with a SidebarGroupLabel.
 */
export const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        title: 'Dashboard',
        url: '/dashboard/overview',
        icon: 'dashboard',
        isActive: false,
        shortcut: ['d', 'd'],
        items: []
      },
      {
        title: 'Product',
        url: '/dashboard/product',
        icon: 'product',
        shortcut: ['p', 'p'],
        isActive: false,
        items: []
      },
      {
        title: 'Users',
        url: '/dashboard/users',
        icon: 'teams',
        shortcut: ['u', 'u'],
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Command Center',
    items: [
      {
        title: 'People',
        url: '/dashboard/people',
        // Existing registry keys — no new @tabler imports needed.
        icon: 'employee',
        shortcut: ['e', 'e'],
        isActive: false,
        items: []
      },
      {
        title: 'Identities',
        url: '/dashboard/identities',
        // Existing registry key — no new @tabler import needed.
        icon: 'userPen',
        shortcut: ['i', 'i'],
        isActive: false,
        items: []
      },
      {
        title: 'Role Profiles',
        url: '/dashboard/role-profiles',
        icon: 'badgeCheck',
        shortcut: ['r', 'r'],
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: '',
    items: [
      {
        title: 'Account',
        url: '#',
        icon: 'account',
        isActive: true,
        items: [
          {
            title: 'Profile',
            url: '/dashboard/profile',
            icon: 'profile',
            shortcut: ['m', 'm']
          },
          {
            title: 'Login',
            shortcut: ['l', 'l'],
            url: '/',
            icon: 'login'
          }
        ]
      }
    ]
  }
];
