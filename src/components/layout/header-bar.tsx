'use client';

/**
 * Top bar — the CLIENT half.
 *
 * 52px tall, bottom border `--border`, 22px horizontal padding, per the mockup:
 *
 *   [crumb] [spacer] [copilot affordance] [shell controls]
 *
 * Owns only what needs the browser: the current-page crumb (`usePathname`) and
 * the copilot input's local text state.
 */

import { AI_SEARCH_URL, navGroups } from '@/config/nav-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SidebarTrigger } from '../ui/sidebar';
import { ThemeModeToggle } from '../themes/theme-mode-toggle';
import { ThemeSelector } from '../themes/theme-selector';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * `input`  — founder / ops_lead: the copilot field plus an Ask button
 * `button` — every other non-agency role: "Ask the AI brain"
 * `none`   — agency, and any actor with no role
 */
export type CopilotVariant = 'input' | 'button' | 'none';

/**
 * The crumb: the CURRENT PAGE's title, not a trail.
 *
 * ⚠️ Resolved from nav-config rather than from the URL, so the bar shows the same
 * words as the sidebar row that led here — "Capture queue", not "Extraction".
 * The two would drift immediately if this humanised the path instead.
 *
 * Falls back to a humanised last segment for pages with no nav entry (a detail
 * route, say). A dynamic segment id would read as noise, so a segment that looks
 * like a uuid is skipped in favour of its parent.
 */
const UUID_ISH = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

function crumbFor(pathname: string): string {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.url === pathname) return item.title;
    }
  }

  // Longest-prefix nav match, so /dashboard/tracker/<id> still says "Tracker".
  let best: { len: number; title: string } | null = null;
  for (const group of navGroups) {
    for (const item of group.items) {
      if (pathname.startsWith(`${item.url}/`) && (!best || item.url.length > best.len)) {
        best = { len: item.url.length, title: item.title };
      }
    }
  }
  if (best) return best.title;

  const segments = pathname.split('/').filter(Boolean);
  // toReversed, not reverse: reverse mutates, and `segments` is read again below
  // if this ever grows a second use. A mutating helper inside a pure formatter is
  // the kind of thing that breaks the second caller, not the first.
  const meaningful = segments.toReversed().find((s) => !UUID_ISH.test(s) && s !== 'dashboard');
  if (!meaningful) return 'Dashboard';

  return meaningful
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function HeaderBar({ copilot }: { copilot: CopilotVariant }) {
  const pathname = usePathname();
  const crumb = crumbFor(pathname);

  return (
    // 52px and a bottom border per the mockup. Sticky and translucent is kept
    // from the previous bar — the content area scrolls under it on long pages.
    <header className='border-border bg-background/80 sticky top-0 z-20 flex h-[52px] shrink-0 items-center gap-2 border-b px-[22px] backdrop-blur-md'>
      {/* ⚠️ KEPT, though the mockup does not show it: this is the only way to open
          the sidebar on mobile, where the rail is a sheet. Dropping it would make
          the app unnavigable below md. */}
      <SidebarTrigger className='-ml-2 md:hidden' />

      <span className='text-muted-foreground truncate text-[13.5px] font-semibold'>{crumb}</span>

      <div className='flex-1' />

      {copilot === 'input' && <CopilotInput />}
      {copilot === 'button' && (
        <Button
          variant='outline'
          size='sm'
          className='h-[34px] text-[13px]'
          // aria-label on the RENDERED anchor: the a11y rule inspects the element
          // inside `render` and cannot see that its text arrives as the Button's
          // children. Same pattern as the sidebar's nav rows.
          render={<Link href={AI_SEARCH_URL} aria-label='Ask the AI brain' />}
        >
          Ask the AI brain
        </Button>
      )}

      {/* ⚠️ KEPT for the same reason as the trigger: theme switching is existing,
          actively-maintained functionality and the mockup's bar simply does not
          depict it. Remove these two if the mockup is meant to be exhaustive. */}
      <ThemeModeToggle />
      <div className='hidden sm:block'>
        <ThemeSelector />
      </div>
    </header>
  );
}

/**
 * The founder/ops copilot field.
 *
 * ⚠️ THERE IS NO COPILOT BACKEND. Both the field and the button navigate to the
 * AI-search page, carrying the typed text as `?q=`. It does not answer anything
 * yet, and it must not look as though it does — so there is no spinner, no
 * optimistic answer panel, and no local echo of the question.
 */
function CopilotInput() {
  const router = useRouter();
  const [value, setValue] = React.useState('');

  function submit() {
    const q = value.trim();
    router.push(q ? `${AI_SEARCH_URL}?q=${encodeURIComponent(q)}` : AI_SEARCH_URL);
  }

  return (
    <form
      className='flex items-center gap-2'
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='Ask the copilot — @command-center…'
        aria-label='Ask the copilot'
        className='h-[34px] w-[280px] text-[13px]'
      />
      <Button type='submit' variant='outline' size='sm' className='h-[34px] text-[13px]'>
        Ask
      </Button>
    </form>
  );
}
