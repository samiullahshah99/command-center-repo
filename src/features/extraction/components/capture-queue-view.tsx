'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { SampleDataCaption } from '@/components/sample-data-caption';
import { InsetBox, LABEL_CAPS, Panel, Screen, TagPill } from '@/components/ui/panel';
import { cn } from '@/lib/utils';
import { formatDueDate } from '@/lib/format-date';
import { captureQueueOptions } from '../api/queries';
import { approveCandidateMutation, rejectCandidateMutation } from '../api/mutations';
import type { CaptureProvenance, CaptureQueue, QueueCandidate } from '../api/types';

/**
 * The Capture queue.
 *
 * ⚠️ THIS IS A RESTYLE OF A WORKING FLOW. Approve and dismiss call the EXISTING
 * `approveCandidateMutation` / `rejectCandidateMutation` — the same server
 * transaction, the same `SELECT … FOR UPDATE`, the same promotion into the Inbox
 * project, and the same cache invalidation across the tracker and person-profile
 * caches. Nothing about the review path changed; only its presentation did.
 *
 * ⚠️ CANDIDATES ARE RENDERED, NEVER EDITED HERE. A candidate row is the record of
 * what the MODEL produced. Corrections belong on the promoted `tracked_item` with
 * `edited_fields` naming them — the extraction detail page keeps the narrow
 * description/due-date edit affordance for that. Editing in this queue would
 * overwrite the evidence the precision metric is measured against.
 *
 * ── Amendment relabels ──────────────────────────────────────────────────────
 * The mockup predates the 2026-08-04 amendment, so three strings change:
 * "…before syncing to ClickUp" → "…before landing on the tracker", "Synced to
 * ClickUp" → "Added to tracker", and every other ClickUp-as-destination mention →
 * tracker. The Command Centre is the task system of record and NO ClickUp write
 * path exists or is to be built.
 */
export function CaptureQueueView() {
  const { data } = useSuspenseQuery(captureQueueOptions());

  // ⚠️ ONE `now` for the subtree, from the SERVER's value. A per-render clock
  // differs between SSR and hydration and React discards the subtree.
  const now = useMemo(() => new Date(data.now), [data.now]);

  return (
    <Screen>
      <div>
        <h1 className='text-[21px] leading-none font-bold tracking-[-0.01em]'>Agentic capture</h1>
        <p className='text-muted-foreground mt-[6px] max-w-[680px] text-[13px] leading-[1.5]'>
          Meetings and Slack become tracked, assigned, deadlined action items. Suggestions require
          approval before landing on the tracker.
        </p>
      </div>

      <div className='grid items-start gap-[14px] lg:grid-cols-2'>
        <div className='flex flex-col gap-[14px]'>
          <SourceCard
            title='Slack MCP'
            provenance={data.slack}
            avatarInitials={initialsOf(data.slack.authorName)}
          />
          <SourceCard title='Fireflies transcript' provenance={data.meeting} italicQuote />
        </div>

        <ReviewQueue data={data} now={now} />
      </div>

      <Ledger data={data} />
    </Screen>
  );
}

function initialsOf(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * An incoming-source provenance card.
 *
 * ⚠️ READ-ONLY. The mockup puts an "Ingest" button on each of these
 * (`ingestSlack` / `ingestFF`); they are DELIBERATELY NOT BUILT. A button that
 * manufactures `raw_event` rows would write invented content beside genuine
 * webhook deliveries, and there is no correct way to originate an inbound webhook
 * from a click. Ingestion is webhook-driven; these cards show what actually
 * arrived.
 *
 * ⚠️ NEVER FABRICATES A MESSAGE. With no capture from a source, the card states
 * that plainly rather than showing a plausible one.
 */
function SourceCard({
  title,
  provenance,
  avatarInitials,
  italicQuote = false
}: {
  title: string;
  provenance: CaptureProvenance;
  avatarInitials?: string;
  italicQuote?: boolean;
}) {
  const meta = [provenance.contextLabel, provenance.when].filter(Boolean).join(' · ');

  return (
    <Panel title={title} meta={meta ? <span className='text-[11px]'>{meta}</span> : undefined}>
      {provenance.quote === null ? (
        <p className='text-muted-foreground text-[12.5px] leading-[1.5] italic'>
          {provenance.emptyCopy}
        </p>
      ) : (
        <InsetBox>
          <div className='flex items-start gap-[10px]'>
            {avatarInitials && (
              <span
                aria-hidden
                className='bg-muted text-muted-foreground flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-[11px] font-bold'
              >
                {avatarInitials}
              </span>
            )}
            <div className='min-w-0 flex-1'>
              {provenance.authorName && (
                <p className='text-[12px]'>
                  <span className='font-bold'>{provenance.authorName}</span>
                  {provenance.when && (
                    <span className='text-muted-foreground ml-[6px] text-[11px]'>
                      {provenance.when}
                    </span>
                  )}
                </p>
              )}
              <p
                className={cn(
                  'mt-[3px] leading-[1.5]',
                  italicQuote ? 'text-muted-foreground text-[12.5px] italic' : 'text-[13px]'
                )}
              >
                {provenance.quote}
              </p>
            </div>
          </div>
        </InsetBox>
      )}
    </Panel>
  );
}

function ReviewQueue({ data, now }: { data: CaptureQueue; now: Date }) {
  return (
    <Panel
      title='Review queue'
      meta={<span className='text-[11.5px]'>{data.pendingTotal} pending</span>}
    >
      {data.pending.length === 0 ? (
        <p className='text-muted-foreground py-8 text-center text-[13px]'>
          Queue clear — nothing awaiting review.
        </p>
      ) : (
        <div className='flex flex-col gap-[10px]'>
          {data.pending.map((c) => (
            <CandidateCard key={c.id} candidate={c} now={now} />
          ))}
        </div>
      )}

      {data.pendingTotal > data.pending.length && (
        <p className='text-muted-foreground text-[11.5px]'>
          +{data.pendingTotal - data.pending.length} more pending
        </p>
      )}

      {data.landed.length > 0 && (
        <div className='mt-[6px] border-t pt-[12px]'>
          {/* ⚠️ AMENDMENT RELABEL — the mockup says "Synced to ClickUp". */}
          <div className={cn(LABEL_CAPS, 'mb-[8px]')}>Added to tracker</div>
          <ul className='flex flex-col gap-[6px]'>
            {data.landed.map((l) => (
              <li key={l.candidateId} className='flex items-center gap-[8px]'>
                <Icons.circleCheck className='text-success size-[13px] shrink-0' aria-hidden />
                {l.projectId ? (
                  <Link
                    href={`/dashboard/tracker/${l.projectId}`}
                    className='min-w-0 flex-1 truncate text-[12.5px] hover:underline'
                  >
                    {l.title}
                  </Link>
                ) : (
                  <span className='min-w-0 flex-1 truncate text-[12.5px]'>{l.title}</span>
                )}
                <span className='text-muted-foreground shrink-0 text-[11.5px]'>{l.ownerLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/**
 * One pending candidate.
 *
 * ⚠️ Approve and Dismiss are GENUINE ACTION BUTTONS — they mutate. They stay
 * `<Button>`s with `onClick`, not `<Link>`s: the Base UI `nativeButton` rule is
 * about NAVIGATION styled as a button, and inverting it here would be wrong.
 */
function CandidateCard({ candidate, now }: { candidate: QueueCandidate; now: Date }) {
  const approve = useMutation(approveCandidateMutation);
  const reject = useMutation(rejectCandidateMutation);

  const busy = approve.isPending || reject.isPending;
  const result = approve.data ?? reject.data;

  // A settled row stays visible until the invalidated query returns, so the list
  // does not jump under the cursor mid-review.
  const settled = result?.ok === true;

  const due = formatDueDate(candidate.dueDate, now);

  /**
   * ⚠️ A FUZZY OR UNRESOLVED OWNER MUST LOOK LIKE A SUGGESTION, NOT A FACT. A
   * reviewer skimming a queue accepts whatever is pre-filled, so a coin-flip guess
   * presented as settled launders itself into an approval. `fuzzy` shows the name
   * with an explicit unverified marker; `unresolved` shows no name at all.
   */
  const needsOwnerDecision =
    candidate.ownerConfidence === 'fuzzy' || candidate.ownerConfidence === 'unresolved';

  return (
    <InsetBox className={cn('flex flex-col gap-[6px]', settled && 'opacity-60')}>
      <div className='flex items-start gap-[8px]'>
        <p className='min-w-0 flex-1 text-[13px] leading-[1.45] font-semibold'>
          {candidate.description}
        </p>
        {/*
          Confidence pill. ⚠️ SUCCESS TOKEN via TagPill, never `text-emerald-600` —
          a palette literal renders wrong in one of the two modes, which is the bug
          the semantic-token adoption removed everywhere else.
        */}
        <TagPill tone='success' title="The model's own confidence that this is a real commitment">
          {Math.round(candidate.confidence * 100)}%
        </TagPill>
      </div>

      {/* The verbatim quote — the reviewer's only way to verify the item. */}
      <p className='text-muted-foreground text-[12px] leading-[1.5] italic'>
        “{candidate.sourceSpan}”
      </p>

      <div className='flex flex-wrap items-center gap-x-[8px] gap-y-[4px]'>
        {candidate.ownerConfidence === 'unresolved' ? (
          <span className='text-muted-foreground text-[11.5px]'>Unresolved owner</span>
        ) : (
          <span className='flex items-center gap-[4px] text-[11.5px] font-semibold'>
            {candidate.ownerPersonName ?? candidate.ownerName}
            {candidate.ownerConfidence === 'fuzzy' && (
              <Icons.alertCircle
                className='text-warning-muted-foreground size-[12px]'
                aria-label='Name-similarity suggestion — unverified'
              />
            )}
          </span>
        )}

        <span className='text-muted-foreground text-[11.5px]'>
          {due.absent ? 'no due date' : `due ${due.label}`}
        </span>

        <TagPill>{candidate.sourceLabel}</TagPill>

        {needsOwnerDecision && candidate.ownerConfidence === 'fuzzy' && (
          <span className='text-warning-muted-foreground text-[11px]'>needs confirmation</span>
        )}

        <div className='flex-1' />

        <Button
          size='sm'
          variant='ghost'
          disabled={busy || settled}
          onClick={() => reject.mutate(candidate.id)}
        >
          {reject.isPending ? 'Dismissing…' : 'Dismiss'}
        </Button>
        <Button
          size='sm'
          disabled={busy || settled}
          // No `edits` — this queue renders the model's output as-is. See the
          // header on candidate immutability.
          onClick={() => approve.mutate({ candidateId: candidate.id })}
        >
          {approve.isPending ? 'Approving…' : 'Approve'}
        </Button>
      </div>

      {result && !result.ok && (
        <p
          className={cn(
            'text-[11.5px]',
            result.reason === 'already_decided' ? 'text-muted-foreground' : 'text-destructive'
          )}
        >
          {result.reason === 'already_decided'
            ? `Already ${result.currentStatus}.`
            : result.message}
        </p>
      )}
    </InsetBox>
  );
}

/**
 * The auto-completion ledger.
 *
 * ⚠️ HYBRID, and the caption says which half. TASK and OWNER are real
 * `recurring_task` rows; EVIDENCE and WHEN are invented because the completion
 * engine does not exist — `completion_event` has 0 rows and no writer.
 */
function Ledger({ data }: { data: CaptureQueue }) {
  return (
    <Panel
      title='Auto-completion ledger'
      meta={<span className='text-[11.5px]'>completion is evidenced, not self-declared</span>}
    >
      {data.ledger.detailIsSample && (
        <SampleDataCaption what='the completion engine is not built, so evidence and timing are illustrative — the tasks and owners are real.' />
      )}

      {data.ledger.rows.length === 0 ? (
        <p className='text-muted-foreground text-[12.5px]'>No recurring tasks configured.</p>
      ) : (
        <div className='overflow-x-auto'>
          <div className='min-w-[560px]'>
            <div
              className={cn(
                LABEL_CAPS,
                'grid grid-cols-[1.2fr_0.6fr_1.6fr_0.6fr] gap-[10px] border-b pb-[7px]'
              )}
            >
              <span>Task</span>
              <span>Owner</span>
              <span>Evidence</span>
              <span>When</span>
            </div>

            {data.ledger.rows.map((r) => (
              <div
                key={r.id}
                className='grid grid-cols-[1.2fr_0.6fr_1.6fr_0.6fr] gap-[10px] border-b py-[8px] text-[12.5px] last:border-b-0'
              >
                <span className='min-w-0 truncate font-semibold'>{r.task}</span>
                <span className='text-muted-foreground min-w-0 truncate'>{r.owner}</span>
                <span className='text-muted-foreground min-w-0'>{r.evidence}</span>
                <span className='text-success-muted-foreground min-w-0 truncate'>{r.when}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
