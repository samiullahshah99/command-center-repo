'use client';

import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import type { NavBadgeKey } from '@/types';

/**
 * Sidebar count pills, fed by one shared fetch of GET /api/nav-badges.
 *
 * ⚠️ ONE QUERY FOR ALL BADGES. `useNavBadges` is called by each badge but shares
 * a single TanStack cache entry, so N badges are still one request. Do not give
 * a badge its own endpoint.
 */

export type NavBadgeCounts = Record<NavBadgeKey, number>;

const NAV_BADGES_KEY = ['nav-badges'] as const;

export function useNavBadges() {
  return useQuery({
    queryKey: NAV_BADGES_KEY,
    queryFn: async (): Promise<NavBadgeCounts> => {
      const res = await fetch('/api/nav-badges');
      if (!res.ok) throw new Error(`nav-badges ${res.status}`);
      return res.json();
    },
    /**
     * The server already caches for 60s, so polling faster only adds requests
     * that return the same numbers. Matching the two windows keeps the client
     * from being the thing that makes this chatty.
     */
    staleTime: 60_000,
    /**
     * ⚠️ A badge is decoration on navigation. It must never retry-storm or throw
     * into the layout — the sidebar renders on all 20+ pages, so an error here
     * would be an app-wide failure over an integer.
     */
    retry: false,
    refetchOnWindowFocus: false
  });
}

/**
 * A count pill. Renders NOTHING at zero — an explicit "0" invites the reader to
 * check something that is already clear, and a permanent grey zero beside every
 * item is noise that trains people to stop looking at the badges that matter.
 */
export function NavBadge({
  count,
  tone = 'neutral',
  className
}: {
  count: number | undefined;
  /**
   * `amber` marks a count that needs a decision rather than just attention.
   * Wired now, unused until Day 4 gives `reviewPending` its
   * fuzzy/unresolved-owner condition — the variant ships so that lands as a
   * one-line change rather than a component edit.
   */
  tone?: 'neutral' | 'amber';
  className?: string;
}) {
  if (!count || count <= 0) return null;

  return (
    <span
      className={cn(
        'ml-auto flex min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums',
        // Hidden when the rail is icon-collapsed: at 48px the row shows only its
        // icon and a pill would push it off its own centre.
        'group-data-[collapsible=icon]:hidden',
        tone === 'amber'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-sidebar-accent text-sidebar-accent-foreground',
        className
      )}
      // 99+ keeps the pill a fixed width; a four-digit count would reflow the row.
      aria-label={`${count} items`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
