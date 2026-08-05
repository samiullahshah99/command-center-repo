import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The portal's design language, transcribed once from
 * `docs/design-reference/Command_Center_dc.html`.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * The mock is a single HTML artifact built from inline styles, and its type
 * scale is unusual on purpose — 11.5px uppercase labels, 26px stat values,
 * 12.5px body, 18px card padding. None of that maps onto a Tailwind default, so
 * every screen restyled by hand accumulates its own slightly-wrong copy of the
 * numbers: 11px here, 12px there, `p-4` where the mock says 18px. After three
 * screens the design has already drifted and there is nothing to diff against.
 *
 * So the scale is stated ONCE, here, and screens import it.
 *
 * ⚠️ THIS DOES NOT RESTYLE shadcn's `Card`. The mock overrides card padding
 * globally (`.cc-root [data-slot="card"]{padding:16px 18px}`) and we deliberately
 * do not: `Card` is used across 20+ routes, its horizontal padding actually lives
 * on `CardHeader`/`CardContent`, and changing the primitive would reflow every
 * page at once AND conflict with the next shadcn update. `Panel` is a wrapper
 * over `Card` instead, so migration is per-screen and reversible.
 *
 * ⚠️ THE `[18px]`-STYLE ARBITRARY VALUES ARE DELIBERATE — do not "canonicalise"
 * them. Your editor's Tailwind plugin will offer `gap-[14px]` → `gap-3.5`,
 * `p-[18px]` → `p-4.5` and so on, and at `--spacing: 0.25rem` those are exactly
 * equivalent today. They are still the wrong edit: these numbers are transcribed
 * from a design artifact, and the only way to check a screen against the mock is
 * to read the same number in both. `p-4.5` turns every future comparison into
 * mental arithmetic, and it silently stops matching if `--spacing` is ever
 * retuned. Arbitrary values are correct precisely here — for constants that came
 * from outside the scale. `pnpm lint:strict` does not flag them; that plugin is
 * advisory and is not a project gate.
 *
 * ⚠️ ADOPT THE MOCK'S LOOK, NEVER ITS CONTENT. Every screen in that file is
 * populated with invented data — named people who do not work here, a Zendesk
 * feed, "482 tickets · CSAT 4.6", four departments we do not model. Nothing in
 * this module renders a value; they are all containers, precisely so that
 * reaching for one cannot smuggle a fabricated number onto a page.
 */

/** Uppercase section/stat label: 11.5px, 600, .06em, muted. */
export const LABEL_CAPS =
  'text-muted-foreground text-[11.5px] font-semibold tracking-[0.06em] uppercase';

/** Big number: 26px, 700, -0.02em. Tabular so digits do not reflow on refresh. */
export const STAT_VALUE = 'text-[26px] leading-none font-bold tracking-[-0.02em] tabular-nums';

/** The detail-view stat: 21px. Used on the person profile's signal cards. */
export const STAT_VALUE_MD = 'text-[21px] leading-none font-bold tabular-nums';

/** Card heading: 14px, 600. */
export const CARD_TITLE = 'text-[14px] font-semibold';

/** List-row heading: 13px, 600. */
export const ROW_TITLE = 'text-[13px] leading-[1.4] font-semibold';

/** Row secondary line: 11.5px, muted. */
export const ROW_META = 'text-muted-foreground text-[11.5px]';

/** Body copy inside a panel: 12.5px. */
export const BODY_TEXT = 'text-[12.5px] leading-[1.6]';

/**
 * Screen wrapper: column, 18px gutters, capped width.
 *
 * The mock caps at 1180px (1080px on the person profile). Without a cap the
 * three-across grids stretch to fill an ultrawide monitor and the 13px row text
 * ends up on 200-character lines, which is unreadable in a way that only shows
 * up on someone else's display.
 */
export function Screen({
  children,
  width = 'wide',
  className
}: {
  children: ReactNode;
  width?: 'wide' | 'narrow';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-[18px]',
        width === 'wide' ? 'max-w-[1180px]' : 'max-w-[1080px]',
        className
      )}
    >
      {children}
    </div>
  );
}

/** Uppercase label sitting above a grid or list. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(LABEL_CAPS, 'mb-[10px]', className)}>{children}</div>;
}

/**
 * A content card at the mock's 18px padding / 12px gap.
 *
 * `title` and `meta` render the mock's standard header row — a 14px semibold
 * title on the left, muted 11.5px text pushed right. Passing neither renders a
 * bare padded card.
 */
export function Panel({
  title,
  meta,
  children,
  className,
  bodyClassName
}: {
  title?: ReactNode;
  /** Right-aligned muted text or a link. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Applied to the inner column when the header row is present. */
  bodyClassName?: string;
}) {
  return (
    <Card className={cn('gap-[12px] p-[18px]', className)}>
      {(title || meta) && (
        <div className='flex items-baseline gap-2'>
          {title && <div className={cn(CARD_TITLE, 'min-w-0 flex-1')}>{title}</div>}
          {meta && <div className={cn(ROW_META, 'shrink-0')}>{meta}</div>}
        </div>
      )}
      {bodyClassName ? <div className={bodyClassName}>{children}</div> : children}
    </Card>
  );
}

/**
 * A single metric: uppercase label, big number, muted sub-line.
 *
 * ⚠️ `value` is a ReactNode rather than a number so a screen can render a real
 * non-numeric state, but there is deliberately NO "loading" or "—" default. A
 * dash standing in for a number we did not fetch is exactly the failure
 * `features/home/api/types.ts` forbids: it reads as data and is not.
 */
export function StatCard({
  label,
  value,
  sub,
  subClassName,
  href,
  leading,
  size = 'lg',
  className
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Tone override for the sub-line. Keep colour rare — see the note below. */
  subClassName?: string;
  href?: string;
  /** Optional dot or icon rendered before the label. */
  leading?: ReactNode;
  /**
   * `lg` (26px) is the Control Tower headline stat; `md` (21px) is the person
   * profile's signal card. The mock draws that distinction deliberately — a
   * profile is a detail view and its numbers should not shout as loudly as the
   * ones on the page whose entire job is triage.
   */
  size?: 'lg' | 'md';
  className?: string;
}) {
  const gap = size === 'lg' ? 'gap-[6px]' : 'gap-[5px]';

  const body = (
    <>
      <div className='flex items-center gap-[8px]'>
        {leading}
        <span className={LABEL_CAPS}>{label}</span>
      </div>
      {/* Zero is DATA, not an empty state — it renders as 0. */}
      <div className={size === 'lg' ? STAT_VALUE : STAT_VALUE_MD}>{value}</div>
      {sub && (
        <div
          className={cn(
            size === 'lg' ? 'text-[12px]' : 'text-[11.5px]',
            subClassName ?? 'text-muted-foreground'
          )}
        >
          {sub}
        </div>
      )}
    </>
  );

  return (
    <Card
      className={cn(
        gap,
        size === 'lg' ? 'p-[16px_18px]' : 'p-[14px_16px]',
        href && 'hover:border-ring transition-colors',
        className
      )}
    >
      {href ? (
        <Link href={href} className={cn('flex flex-col', gap)}>
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

/** The mock's responsive stat row. Four across on desktop, two on tablet. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-[14px] sm:grid-cols-2 lg:grid-cols-4', className)}>{children}</div>
  );
}

/**
 * Outline pill: 10.5px/700, 999px, 1px border, 1px 7px.
 *
 * Defaults to muted. `tone` exists for the few places a pill genuinely encodes
 * state — keep it rare: colour that appears on every pill stops meaning
 * anything, which is the whole reason the Overview restricts red and amber to
 * two widgets.
 */
export function TagPill({
  children,
  tone = 'muted',
  title,
  className
}: {
  children: ReactNode;
  tone?: 'muted' | 'success' | 'warning' | 'destructive';
  /** Native tooltip. A pill is often an abbreviation; this is where it expands. */
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'shrink-0 rounded-full border px-[7px] py-px text-[10.5px] font-bold whitespace-nowrap',
        tone === 'muted' && 'text-muted-foreground',
        // `border-current` is what the mock does: the border tracks the text
        // colour so a tone change is one class, not two that can disagree.
        tone === 'success' && 'text-success-muted-foreground border-current',
        tone === 'warning' && 'text-warning-muted-foreground border-current',
        tone === 'destructive' && 'text-destructive border-current',
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * The mock's bordered inset — a quote, a message preview, a queue row.
 * 10px radius, 1px border, 12px/14px padding.
 */
export function InsetBox({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-[10px] border p-[12px_14px]', className)}>{children}</div>;
}

/**
 * Initials circle. Neutral by default.
 *
 * ⚠️ NO PER-PERSON COLOUR. The mock tints each avatar from a palette, which
 * reads as a status signal on a page that also uses colour for severity — and a
 * hash-to-hue scheme silently recolours someone the day a name is corrected.
 * Neutral keeps colour meaning exactly one thing on every screen.
 */
export function InitialsAvatar({
  initials,
  size = 26,
  className
}: {
  initials: string;
  /** 22 in dense rows, 26 default, 32 on headers. */
  size?: 22 | 26 | 32;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-full font-bold',
        size === 22 && 'size-[22px] text-[10px]',
        size === 26 && 'size-[26px] text-[10.5px]',
        size === 32 && 'size-[32px] text-[12px]',
        className
      )}
    >
      {initials}
    </span>
  );
}

/**
 * A status dot. 7px, matching the mock's presence and health indicators.
 *
 * `neutral` is the default on purpose: most dots on most screens should carry no
 * colour at all.
 */
export function StatusDot({
  tone = 'neutral',
  className
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'destructive';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-[7px] shrink-0 rounded-full',
        tone === 'neutral' && 'bg-muted-foreground/40',
        tone === 'success' && 'bg-success',
        tone === 'warning' && 'bg-warning',
        tone === 'destructive' && 'bg-destructive',
        className
      )}
    />
  );
}

/**
 * List rows separated by a top border, per the mock. The border on the FIRST row
 * is intentional — it closes the gap under the card header.
 */
export function RowList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('flex flex-col', className)}>{children}</ul>;
}

export function Row({
  children,
  href,
  className
}: {
  children: ReactNode;
  href?: string;
  className?: string;
}) {
  const inner = cn('flex items-center gap-[10px] py-[9px]', className);

  return (
    <li className='border-t'>
      {href ? (
        <Link
          href={href}
          className={cn(inner, 'hover:bg-muted/40 -mx-[6px] rounded-[8px] px-[6px]')}
        >
          {children}
        </Link>
      ) : (
        <div className={inner}>{children}</div>
      )}
    </li>
  );
}

/**
 * The "nothing here" state, styled as a RESULT rather than an absence.
 *
 * ⚠️ On a seven-person roster an empty queue is the COMMON case, not an error.
 * An apologetic grey box makes the normal state look like a failed fetch —
 * which is exactly how the locale hydration bug presented, and it sent that
 * investigation into the query layer for an afternoon.
 */
export function EmptyState({
  icon,
  title,
  detail,
  className
}: {
  icon?: ReactNode;
  title: string;
  detail?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 py-10 text-center', className)}>
      {icon && (
        <span className='bg-success-muted text-success-muted-foreground ring-success/20 flex size-10 items-center justify-center rounded-full ring-1'>
          {icon}
        </span>
      )}
      <span className='text-[14px] font-semibold'>{title}</span>
      {detail && <span className='text-muted-foreground max-w-xs text-[12px]'>{detail}</span>}
    </div>
  );
}
