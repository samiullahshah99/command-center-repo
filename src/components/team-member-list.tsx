import Link from 'next/link';
import { Icons } from '@/components/icons';
import { Panel, ROW_META } from '@/components/ui/panel';
import { cn } from '@/lib/utils';

/**
 * One member row's data. Built by each feature's service.
 *
 * ⚠️ `accentVar` is a THEME TOKEN REFERENCE (`var(--chart-2)`), never a colour —
 * see @/lib/person-accent.
 */
export type TeamMemberView = {
  id: string;
  name: string;
  initials: string;
  accentVar: string;
  /** `role.display_name`, or null. Display only — never branch on it. */
  roleLabel: string | null;
  /** Non-terminal items owned by this person. The row's signal. */
  openCount: number;
  /** Profile link, already carrying its `?from=` value. */
  href: string;
};

/**
 * The team member list.
 *
 * ⚠️ SHARED by `/dashboard/my-team` and the department page, pixel-identical.
 * Extracted here rather than cross-imported from a feature.
 *
 * ⚠️ Each row is NAVIGATION — a plain `<Link>`, not a `<Button>` wrapping one.
 * `ButtonPrimitive` declares `nativeButton = true`, so composing an `<a>` into it
 * violates its contract and Base UI warns. These rows are not button-styled, so
 * `buttonVariants` is not needed either.
 */
export function TeamMemberList({
  members,
  title = 'Team',
  emptyCopy = 'No members assigned yet.'
}: {
  members: TeamMemberView[];
  title?: string;
  emptyCopy?: string;
}) {
  return (
    <Panel title={title} meta={<span className='text-[11.5px]'>{members.length}</span>}>
      {members.length === 0 ? (
        <p className='text-muted-foreground text-[12.5px]'>{emptyCopy}</p>
      ) : (
        <div className='divide-y'>
          {members.map((m) => (
            <Link
              key={m.id}
              href={m.href}
              className='hover:bg-muted/50 -mx-[6px] flex items-center gap-[10px] rounded-[8px] px-[6px] py-[9px] transition-colors'
            >
              <span
                aria-hidden
                className='text-primary-foreground flex size-[32px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold'
                style={{ backgroundColor: m.accentVar }}
              >
                {m.initials}
              </span>

              <span className='flex min-w-0 flex-1 flex-col'>
                <span className='truncate text-[13px] font-semibold'>{m.name}</span>
                <span className={cn(ROW_META, 'truncate')}>
                  {m.roleLabel ?? 'No role assigned'}
                </span>
              </span>

              <span className='text-muted-foreground shrink-0 text-[12px]'>{m.openCount} open</span>
              <Icons.chevronRight className='text-muted-foreground size-[14px] shrink-0' />
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}
