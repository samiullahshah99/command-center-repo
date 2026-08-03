import Link from 'next/link';
import { Icons } from '@/components/icons';
import { MOCKUP_TODAY } from '../constants';

/**
 * Chrome shared by all three variants.
 *
 * ⚠️ Present on every page ON PURPOSE. These are review artefacts that will be
 * screenshotted and pasted into a thread, and a polished board with no marking
 * is indistinguishable from shipped functionality — which is how a mockup ends
 * up in a status update as evidence of progress. Stating the frozen date also
 * pre-empts the obvious question about why nothing moves.
 */
export function MockupBanner() {
  return (
    <div className='border-amber-500/40 bg-amber-500/10 mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-2.5'>
      <span className='flex items-center gap-1.5 text-xs font-semibold tracking-wide text-amber-800 uppercase dark:text-amber-200'>
        <Icons.warning className='size-3.5' />
        Static mockup
      </span>
      <span className='text-muted-foreground text-xs'>
        Concept only — nothing here is live, editable, or backed by the database. Dates are frozen
        at {MOCKUP_TODAY} so screenshots stay reproducible.
      </span>
      <Link
        href='/dashboard/tracker-mockups'
        className='text-muted-foreground ml-auto text-xs hover:underline'
      >
        ← all variants
      </Link>
    </div>
  );
}
