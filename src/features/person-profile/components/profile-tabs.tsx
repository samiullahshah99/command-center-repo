'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { PersonProfile } from '../api/types';
import { CalendarTab } from './calendar-tab';
import { MeetingsTab } from './meetings-tab';
import { ProfileItemList } from './profile-item-list';

/**
 * Tasks / Calendar / Meetings.
 *
 * ⚠️ THE TAB LIST IS RESTYLED, NOT REPLACED. `@/components/ui/tabs` defaults to a
 * pill-in-a-muted-tray look; the mockup draws an underlined row. The override is
 * applied HERE, at the call site, rather than by editing the shared primitive —
 * every other screen using Tabs keeps the default, and a component-level change
 * would restyle them all silently.
 */
/**
 * ⚠️ THE STATE ATTRIBUTE IS `data-active`, NOT `data-selected`.
 *
 * base-ui's Tab sets `data-active`. A `data-[selected]:` variant compiles fine,
 * passes tsc and passes oxlint — and silently never matches, so the active tab
 * renders with no underline and muted text. There is no type or lint check that
 * catches a wrong data-attribute in a class string; the only check is looking at
 * the primitive.
 *
 * ⚠️ The dark-mode overrides are NOT redundant. The primitive carries
 * `dark:data-active:bg-input/30` and `dark:data-active:border-input`, and
 * tailwind-merge treats `dark:data-active:*` as a different key from
 * `data-active:*` — so without these the active tab keeps a filled background in
 * dark mode while looking correct in light.
 *
 * ⚠️ `flex-none` because the primitive sets `flex-1`, which would stretch three
 * triggers across the full width instead of leaving them content-sized with an
 * 18px gap.
 */
const TAB_TRIGGER = cn(
  'h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-[2px] pb-[8px]',
  'text-muted-foreground text-[13px] font-medium shadow-none',
  'data-active:border-b-foreground data-active:text-foreground data-active:bg-transparent data-active:shadow-none',
  'dark:text-muted-foreground dark:data-active:bg-transparent dark:data-active:border-b-foreground dark:data-active:text-foreground'
);

export function ProfileTabs({ profile, now }: { profile: PersonProfile; now: Date }) {
  const { items, counts, calendar, meetings } = profile;

  return (
    <Tabs defaultValue='tasks' className='gap-[18px]'>
      <TabsList className='bg-transparent h-auto w-full justify-start gap-[18px] rounded-none border-b p-0'>
        <TabsTrigger value='tasks' className={TAB_TRIGGER}>
          Tasks · {counts.total}
        </TabsTrigger>
        <TabsTrigger value='calendar' className={TAB_TRIGGER}>
          Calendar
        </TabsTrigger>
        <TabsTrigger value='meetings' className={TAB_TRIGGER}>
          Meetings · {meetings.items.length}
        </TabsTrigger>
      </TabsList>

      <TabsContent value='tasks'>
        <ProfileItemList items={items} now={now} />
      </TabsContent>

      <TabsContent value='calendar'>
        <CalendarTab calendar={calendar} />
      </TabsContent>

      <TabsContent value='meetings'>
        <MeetingsTab meetings={meetings} />
      </TabsContent>
    </Tabs>
  );
}
