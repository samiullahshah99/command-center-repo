import { Card } from '@/components/ui/card';
import { SampleDataCaption } from '@/components/sample-data-caption';
import type { ProfileCalendar } from '../api/types';

/**
 * Mon–Fri grid, one card per weekday.
 *
 * ⚠️ EVERY VALUE HERE IS INVENTED. There is no calendar integration — no client,
 * no credentials, no table. See `sampleCalendar()` in ../api/service.ts, and
 * docs/gaps.md.
 *
 * ⚠️ NO TIME FORMATTING IN THIS FILE. `time` and `label` arrive pre-formatted
 * from the service through the pinned-locale helpers. Formatting a date during
 * render is the hydration bug CLAUDE.md documents — the server and browser
 * resolve locale and timezone differently and React discards the subtree.
 *
 * ⚠️ Weekdays only, deliberately. The mockup shows five columns; a Sat/Sun pair
 * that is always empty reads as missing data rather than as a working week.
 */
export function CalendarTab({ calendar }: { calendar: ProfileCalendar }) {
  return (
    <div>
      {calendar.isSample && (
        <SampleDataCaption what='calendar integration is not built, so this week is illustrative.' />
      )}

      <div className='grid grid-cols-2 gap-[10px] sm:grid-cols-3 lg:grid-cols-5'>
        {calendar.days.map((day) => (
          <Card key={day.key} className='gap-[8px] p-[12px]'>
            <div className='text-[12px] font-bold'>{day.label}</div>

            {day.blocks.length === 0 ? (
              <p className='text-muted-foreground text-[11px] italic'>Nothing scheduled</p>
            ) : (
              <div className='flex flex-col gap-[6px]'>
                {day.blocks.map((b) => (
                  <div
                    key={b.id}
                    // 3px left border in a theme token, muted fill, 6px radius.
                    // The token comes from the service so it survives a theme
                    // switch — never a colour literal.
                    className='bg-muted rounded-[6px] py-[5px] pr-[7px] pl-[8px]'
                    style={{ borderLeft: `3px solid ${b.accentVar}` }}
                  >
                    <div className='text-muted-foreground text-[10.5px] tabular-nums'>{b.time}</div>
                    <div className='truncate text-[12px] font-semibold'>{b.title}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
