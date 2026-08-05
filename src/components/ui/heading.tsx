import { InfoButton } from '@/components/ui/info-button';
import type { InfobarContent } from '@/components/ui/infobar';

interface HeadingProps {
  title: string;
  description: string;
  infoContent?: InfobarContent;
}

/**
 * The page title block, rendered for every route through `PageContainer`.
 *
 * ⚠️ Sizes are the design system's page-header scale, transcribed from
 * `docs/design-reference/Command_Center_dc.html` (21px/700/-0.01em title,
 * 12.5px subtitle) — noticeably smaller than the starter's `text-3xl`. This is
 * ONE component behind `PageContainer`, so the change lands on all 20+ pages at
 * once. That is the intent: a title that is 30px here and 21px in the mock's
 * screens is the kind of drift that makes a restyled page look wrong next to an
 * unrestyled one.
 */
export function Heading({ title, description, infoContent }: HeadingProps) {
  return (
    <div>
      <div className='flex items-center gap-2'>
        <h2 className='text-[21px] leading-tight font-bold tracking-[-0.01em]'>{title}</h2>
        {infoContent && <InfoButton content={infoContent} />}
      </div>
      <p className='text-muted-foreground mt-[2px] text-[12.5px]'>{description}</p>
    </div>
  );
}
