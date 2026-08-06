'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

type BreadcrumbItem = {
  title: string;
  link: string;
};

/**
 * Custom breadcrumb trails for paths whose auto-generated one reads badly.
 *
 * ⚠️ `/dashboard/product` and `/dashboard/employee` WERE HERE AND HAVE BEEN
 * REMOVED — both were template routes, and `product` no longer exists at all
 * (deleted with the `products`/`users` features, inventory §4.2). A mapping for a
 * dead route is not inert: it is keyed on `pathname`, so it would silently
 * reappear the day something else is mounted at the same path.
 *
 * Everything not listed falls through to the segment-derived trail below, which
 * is what every real screen uses today.
 */
const routeMapping: Record<string, BreadcrumbItem[]> = {
  '/dashboard': [{ title: 'Dashboard', link: '/dashboard' }]
};

export function useBreadcrumbs() {
  const pathname = usePathname();

  const breadcrumbs = useMemo(() => {
    // Check if we have a custom mapping for this exact path
    if (routeMapping[pathname]) {
      return routeMapping[pathname];
    }

    // If no exact match, fall back to generating breadcrumbs from the path
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((segment, index) => {
      const path = `/${segments.slice(0, index + 1).join('/')}`;
      return {
        title: segment.charAt(0).toUpperCase() + segment.slice(1),
        link: path
      };
    });
  }, [pathname]);

  return breadcrumbs;
}
