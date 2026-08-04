'use client';

import { useMemo, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/format-date';
import { briefBoardQueryOptions } from '../api/queries';
import {
  BRIEF_STATES,
  STALE_DAYS,
  STATE_ACCENT,
  STATE_LABEL,
  type BriefState
} from '../constants/brief-states';
import type { BriefCard } from '../api/types';
import { BriefDetailPanel } from './brief-detail-panel';

/**
 * The derived brief board. READ-ONLY — Vision is the system of record and CC
 * never writes brief state back, so there are no actions on these cards.
 */
export function BriefBoard() {
  const { data } = useSuspenseQuery(briefBoardQueryOptions());
  const [openId, setOpenId] = useState<string | null>(null);

  // ⚠️ ONE `now` for the page, from the SERVER's value. Every "days in state"
  // and relative label derives from it — a per-render clock differs between SSR
  // and hydration and React discards the subtree.
  const now = useMemo(() => new Date(data.now), [data.now]);

  const byState = useMemo(() => {
    const m = new Map<BriefState, BriefCard[]>(BRIEF_STATES.map((s) => [s, []]));
    for (const c of data.cards) m.get(c.state)?.push(c);
    // Longest-in-state FIRST — stuck work rises to the top of every column,
    // which is the only ordering that makes the board answer "what is stalled".
    for (const list of m.values()) {
      list.sort((a, b) => a.stateEnteredAt.localeCompare(b.stateEnteredAt));
    }
    return m;
  }, [data.cards]);

  const selected = data.cards.find((c) => c.id === openId) ?? null;

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid gap-4 lg:grid-cols-4'>
        {BRIEF_STATES.map((state) => {
          const cards = byState.get(state) ?? [];
          return (
            <section key={state} className='flex flex-col gap-2'>
              <header className='flex items-center gap-2 px-1'>
                <span className={cn('size-2 rounded-full', STATE_ACCENT[state])} aria-hidden />
                <h2 className='text-sm font-medium'>{STATE_LABEL[state]}</h2>
                <span className='text-muted-foreground text-xs'>{cards.length}</span>
              </header>

              {cards.length === 0 ? (
                /* Empty columns still render. A lifecycle board whose columns
                   appear and vanish changes shape under the reader; "Approved 0"
                   is a fact worth seeing, not an absence to hide. */
                <div className='text-muted-foreground/70 rounded-lg border border-dashed px-3 py-6 text-center text-xs'>
                  none
                </div>
              ) : (
                cards.map((c) => (
                  <BriefCardView key={c.id} card={c} now={now} onOpen={() => setOpenId(c.id)} />
                ))
              )}
            </section>
          );
        })}
      </div>

      <p className='text-muted-foreground max-w-3xl text-xs'>
        State is <strong>derived</strong> by folding each brief&apos;s Vision events — there is no
        status field. Comments and script saves update activity but never change state. Vision is
        the system of record; this board is read-only and never writes back. {data.total} production
        briefs; non-production environments excluded.
      </p>

      <BriefDetailPanel
        briefId={selected?.id ?? null}
        open={Boolean(selected)}
        onOpenChange={(next) => !next && setOpenId(null)}
      />
    </div>
  );
}

function BriefCardView({ card, now, onOpen }: { card: BriefCard; now: Date; onOpen: () => void }) {
  const days = Math.floor((now.getTime() - new Date(card.stateEnteredAt).getTime()) / 86_400_000);
  const thresholds = STALE_DAYS[card.state];
  const tone =
    thresholds && days >= thresholds.red
      ? 'red'
      : thresholds && days >= thresholds.amber
        ? 'amber'
        : null;

  return (
    <Card className='gap-2 px-3 py-3'>
      <button
        type='button'
        onClick={onOpen}
        aria-label={`Open timeline for ${card.label ?? card.idFragment}`}
        className='text-left'
      >
        <span className='block text-sm font-medium hover:underline'>
          {card.label ?? 'Untitled brief'}
        </span>
        {/*
          Disambiguator, not decoration. Twelve of seventeen briefs share a label
          with another brief ("#4 — Untitled brief" covers three distinct ids), so
          without this the board reads as duplicated cards. Small, muted, mono —
          secondary to the label it is disambiguating.
        */}
        <span className='text-muted-foreground/70 block font-mono text-[10px]'>
          {card.idFragment}
        </span>
      </button>

      <div className='flex items-center gap-1.5 text-xs'>
        {card.strategist ? (
          <>
            <span
              aria-hidden
              className='flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-medium text-slate-600'
            >
              {card.strategist.name.slice(0, 2).toUpperCase()}
            </span>
            <span className='truncate'>{card.strategist.name}</span>
            {/* Vision's editor_name is display-only and mutable (CLAUDE.md): an
                unlinked actor is a label, never an identity. */}
            {!card.strategist.linked && (
              <Badge
                variant='outline'
                title='This Vision account is not linked to a person yet — name is display-only'
                className='shrink-0 px-1 py-0 text-[10px] font-normal'
              >
                unlinked
              </Badge>
            )}
          </>
        ) : (
          <span className='text-muted-foreground'>no strategist</span>
        )}
      </div>

      <div className='flex items-center justify-between text-[11px]'>
        <span
          className={cn(
            'tabular-nums',
            tone === 'red' && 'font-medium text-red-600',
            tone === 'amber' && 'font-medium text-amber-700',
            !tone && 'text-muted-foreground'
          )}
        >
          {days}d in state
        </span>
        <span className='text-muted-foreground'>
          {formatRelativeTime(card.lastActivityAt, now)}
        </span>
      </div>
    </Card>
  );
}
