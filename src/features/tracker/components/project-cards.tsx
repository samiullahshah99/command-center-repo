'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { projectsQueryOptions } from '../api/queries';
import { PROJECT_STATUS_META, SOURCE_SYSTEM_LABEL } from '../constants/tracker-options';
import type { ProjectRollup } from '../api/types';
import { PersonBadge } from './person-badge';

export function ProjectCards() {
  const { data } = useSuspenseQuery(projectsQueryOptions());

  if (data.projects.length === 0) {
    return (
      <Card>
        <CardContent className='text-muted-foreground py-12 text-center text-sm'>
          No projects yet. Run <code className='font-mono'>pnpm db:seed</code> to populate.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
        {data.projects.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>

      {data.unassignedNeedsReview > 0 && (
        <p className='text-muted-foreground text-xs'>
          {data.unassignedNeedsReview} pending action item
          {data.unassignedNeedsReview === 1 ? '' : 's'} not yet attached to a project. The review
          queue arrives in a later increment.
        </p>
      )}
    </div>
  );
}

/**
 * ⚠️ THE CARD IS NOT AN ANCHOR. THE TITLE IS.
 *
 * A card-wrapping <Link> makes every interactive child invalid HTML. It shipped
 * that way and produced a real hydration error — `<a> cannot be a descendant of
 * <a>` — because `PersonBadge` renders its own link to the lead's profile. React
 * discards the mismatched subtree, so the symptom is a card that renders wrong
 * rather than an obvious error at the call site.
 *
 * It also swallowed text selection and forced the `aria-label` workaround below,
 * because the a11y linter could not see the heading through <Card>.
 *
 * So: the TITLE is a real <a> with a real href — middle-click, copy-link and
 * keyboard navigation all work, and it is the accessible name for the
 * destination. The card carries onClick + cursor-pointer for the
 * whole-surface affordance.
 *
 * ⚠️ Deliberately NO role='link' and NO tabIndex on the wrapper. That would
 * announce a SECOND link to the same destination and add a redundant tab stop.
 *
 * The onClick ignores clicks that originated on an interactive element, so the
 * lead's profile link wins over the card's own destination.
 */
function ProjectCard({ project: p }: { project: ProjectRollup }) {
  const status = PROJECT_STATUS_META[p.status];
  const router = useRouter();
  const href = `/dashboard/tracker/${p.id}`;

  return (
    /* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events --
       Deliberate. Both rules want a role + keyboard handler on any clickable
       element; here that would be WRONG. The title below is already a real <a>
       with a real href — it is the keyboard path and the accessible name.
       Giving this wrapper role='link' + tabIndex would announce a duplicate
       link and add a redundant tab stop. The onClick is a mouse-only
       convenience over an already-accessible control, which is the one case
       these rules cannot distinguish. */
    <div
      className='group cursor-pointer'
      onClick={(e) => {
        // Let genuine interactive children win — PersonBadge's profile link.
        if ((e.target as HTMLElement).closest('a,button,input,[role="button"]')) return;
        router.push(href);
      }}
    >
      <Card className='hover:border-primary/40 h-full transition-colors'>
        <CardHeader className='gap-2 pb-3'>
          <div className='flex items-start justify-between gap-3'>
            <h2 className='font-medium'>
              {/* The accessible name for this destination comes from here. */}
              <Link href={href} className='hover:underline group-hover:underline'>
                {p.name}
              </Link>
            </h2>
            <Badge variant='outline' className={cn('shrink-0 text-[11px]', status.badge)}>
              {status.label}
            </Badge>
          </div>
          {p.description && (
            <p className='text-muted-foreground line-clamp-2 text-sm'>{p.description}</p>
          )}
        </CardHeader>

        <CardContent className='flex flex-col gap-4'>
          <div className='flex items-center gap-2 text-sm'>
            <span className='text-muted-foreground text-xs'>Lead</span>
            <PersonBadge person={p.lead} />
          </div>

          {/* The three rollups leadership asked for. Zero is rendered muted
              rather than hidden — a project with no overdue work is a fact
              worth showing, and a disappearing stat makes cards jump around. */}
          <div className='grid grid-cols-3 gap-2 border-t pt-3'>
            <Stat label='open' value={p.openCount} />
            <Stat
              label='overdue'
              value={p.overdueCount}
              tone={p.overdueCount > 0 ? 'danger' : undefined}
            />
            <Stat
              label='needs review'
              value={p.needsReviewCount}
              tone={p.needsReviewCount > 0 ? 'warn' : undefined}
            />
          </div>

          {p.externalSystem && p.externalSystem !== 'internal' && (
            <span className='text-muted-foreground flex items-center gap-1 text-xs'>
              <Icons.externalLink className='size-3' />
              mirrors {SOURCE_SYSTEM_LABEL[p.externalSystem]}
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'warn' }) {
  return (
    <div className='flex flex-col'>
      <span
        className={cn(
          'font-mono text-xl',
          tone === 'danger' && 'text-red-600 dark:text-red-400',
          tone === 'warn' && 'text-amber-700 dark:text-amber-300',
          !tone && value === 0 && 'text-muted-foreground'
        )}
      >
        {value}
      </span>
      <span className='text-muted-foreground text-[11px] tracking-wide uppercase'>{label}</span>
    </div>
  );
}
