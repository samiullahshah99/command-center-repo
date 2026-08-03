import { Card, CardContent } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { MOCKUP_TODAY } from '../../constants';
import { AI_SUMMARIES } from '../../fixtures';

/**
 * The AI-summary preview — the thing leadership actually asked to see.
 *
 * ⚠️ THE PROSE IS HARDCODED. Nothing generates it, nothing reads a transcript,
 * no model is called. It is written to match each person's fixture items so it
 * survives a close read in a screenshot, which makes it MORE likely to be
 * mistaken for a working feature — hence the explicit label in the footer and
 * the page-level static-mockup banner. Both stay.
 *
 * Placed ABOVE the item list on purpose: the ask was "AI-native", and burying
 * the summary under a table frames it as decoration rather than as the lead.
 */
export function AiSummaryCard({ personName }: { personName: string }) {
  const lines = AI_SUMMARIES[personName];
  if (!lines || lines.length === 0) return null;

  return (
    <Card className='border-violet-500/30 bg-gradient-to-br from-violet-500/[0.07] to-transparent'>
      <CardContent className='flex flex-col gap-3 pt-6'>
        <div className='flex items-center gap-2'>
          {/* Existing registry icon — no new @tabler import, per CLAUDE.md. */}
          <span className='flex size-6 items-center justify-center rounded-md bg-violet-500/15'>
            <Icons.sun className='size-3.5 text-violet-600 dark:text-violet-400' />
          </span>
          <h3 className='text-sm font-semibold'>Summary</h3>
          <span className='rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-violet-700 uppercase dark:text-violet-300'>
            AI generated
          </span>
          <span className='text-muted-foreground ml-auto text-[11px]'>as of {MOCKUP_TODAY}</span>
        </div>

        <div className='flex flex-col gap-2'>
          {lines.map((line) => (
            <p key={line} className='text-sm leading-relaxed'>
              {line}
            </p>
          ))}
        </div>

        <p className='text-muted-foreground/80 border-t pt-2.5 text-[11px]'>
          Placeholder text — this card is a static concept. A real summary would be produced from
          the person&rsquo;s tracked items and meeting activity, and would carry the sources it drew
          on so a reader can check it.
        </p>
      </CardContent>
    </Card>
  );
}
