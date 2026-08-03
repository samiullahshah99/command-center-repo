// ============================================================
// Extraction Demo Service — Data Access Layer
// ============================================================
// Pattern 1, as in src/features/identities/api/service.ts: Server Actions + ORM.
//
// 'use server' is REQUIRED. queries.ts is consumed on both sides of the SSR
// handoff — the server prefetches, and the browser re-runs the same queryFn when
// polling or refetching, where Drizzle, `pg` and the Fireflies key cannot go.
//
// ⚠️ THIS IS WHAT KEEPS FIREFLIES_API_KEY OFF THE CLIENT. Every function here
// executes on the server even when invoked from a browser event; only the
// serialised return value crosses the wire. There is no code path in this
// feature where the key is read outside a server context, and none may be added.
//
// Every export must be an async function ('use server' contract). Types live in
// ./types.ts for that reason.
// ============================================================

'use server';

import { desc, eq, inArray, sql } from 'drizzle-orm';
import { auth, currentUser } from '@clerk/nextjs/server';
import { db } from '@/db';
import {
  candidateActionItem,
  person,
  project,
  trackedItem,
  transcript,
  unifiedEvent
} from '@/db/schema';
import {
  FirefliesGraphQLError,
  listTranscripts,
  type FirefliesTranscriptListItem
} from '@/features/connectors/fireflies/client';
import {
  FALLBACK_PROJECT_NAME,
  INBOX_PROJECT_DESCRIPTION,
  promotionProjectFor
} from '../constants/promotion';
import { approveCandidateSchema, rejectCandidateSchema } from '../schemas/review';
import type {
  ActionItemRow,
  ExtractionDetail,
  ExtractionStatusResponse,
  MeetingBlockedReason,
  MeetingListResponse,
  MeetingRow,
  MeetingStatus,
  OwnerConfidenceLevel,
  ReviewResult
} from './types';

/**
 * Auth on every read.
 *
 * ⚠️ Not belt-and-braces. src/proxy.ts matches /dashboard(.*) and protects the
 * PAGES, but a Server Action is its own POST endpoint that does not necessarily
 * go through that matcher — and `createRouteMatcher` is deprecated precisely
 * because its path matching can diverge from how Next.js actually routes. These
 * functions return real meeting content, so they check for themselves.
 */
/**
 * Who made this decision, for the audit trail.
 *
 * Prefers the email over the Clerk id — `reviewed_by` is read by a human months
 * later asking "who approved this?", and `user_2abc…` answers that badly. Same
 * approach as src/features/identities/api/service.ts.
 */
async function actorLabel(): Promise<string> {
  const u = await currentUser();
  return (
    u?.primaryEmailAddress?.emailAddress ??
    u?.emailAddresses?.[0]?.emailAddress ??
    u?.id ??
    'unknown'
  );
}

async function requireUser(): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
}

/** Fireflies reports `duration` in MINUTES, fractional. This column is seconds. */
function toSeconds(duration: number | null | undefined): number | null {
  return typeof duration === 'number' ? Math.round(duration * 60) : null;
}

function toIso(value: number | string | null | undefined): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/**
 * Turn an upstream failure into something a row can say out loud.
 *
 * The plan case is separated deliberately and is NOT an error state: the list
 * endpoint is not plan-gated but `transcript(id:)` is, so a meeting can be
 * visible and unopenable at the same time. That is a known billing constraint
 * being raised with the lead, and showing it as a red generic failure would
 * misrepresent a product decision as a bug.
 */
export async function describeFirefliesError(
  err: unknown
): Promise<{ reason: MeetingBlockedReason; message: string }> {
  if (err instanceof FirefliesGraphQLError) {
    if (err.isPlanError) {
      return {
        reason: 'plan',
        message: 'Not available on the current Fireflies plan'
      };
    }
    if (err.isAuthError) {
      return { reason: 'auth', message: 'Fireflies rejected our credentials' };
    }
    if (err.isNotReady) {
      return {
        reason: 'not_ready',
        message: 'Fireflies has not finished producing this transcript yet'
      };
    }
    return { reason: 'error', message: err.message };
  }
  return { reason: 'error', message: err instanceof Error ? err.message : String(err) };
}

/** What our database already knows about a set of Fireflies ids. */
async function localStateFor(firefliesIds: string[]) {
  if (firefliesIds.length === 0) {
    return new Map<string, { itemCount: number; unifiedEventId: string | null }>();
  }

  const rows = await db
    .select({
      firefliesId: transcript.firefliesId,
      unifiedEventId: sql<string | null>`(
        select ue.id from ${unifiedEvent} ue
        where ue.subject_id = ${transcript.firefliesId} and ue.source = 'fireflies'
        order by ue.occurred_at desc limit 1
      )`,
      itemCount: sql<number>`(
        select count(*)::int from ${candidateActionItem} c
        where c.unified_event_id = (
          select ue.id from ${unifiedEvent} ue
          where ue.subject_id = ${transcript.firefliesId} and ue.source = 'fireflies'
          order by ue.occurred_at desc limit 1
        )
      )`
    })
    .from(transcript)
    .where(inArray(transcript.firefliesId, firefliesIds));

  return new Map(
    rows.map((r) => [r.firefliesId, { itemCount: r.itemCount, unifiedEventId: r.unifiedEventId }])
  );
}

/**
 * Meetings from Fireflies, annotated with what we already hold.
 *
 * ⚠️ A Fireflies outage must NOT blank the page. Anything already fetched lives
 * in our own tables and stays browsable; the upstream failure is reported as a
 * banner rather than thrown, so the demo degrades to "the meetings you already
 * have" instead of an error screen.
 */
export async function getMeetings(limit = 25): Promise<MeetingListResponse> {
  await requireUser();

  let upstream: FirefliesTranscriptListItem[] = [];
  let listError: MeetingListResponse['listError'];

  try {
    upstream = await listTranscripts(limit);
  } catch (err) {
    listError = await describeFirefliesError(err);
  }

  const local = await localStateFor(upstream.map((t) => t.id));

  const meetings: MeetingRow[] = upstream.map((t) => {
    const known = local.get(t.id);
    let status: MeetingStatus = 'not_fetched';
    if (known) {
      status =
        known.itemCount > 0 ? 'extracted' : known.unifiedEventId ? 'extracted_empty' : 'pending';
    }

    return {
      firefliesId: t.id,
      title: t.title ?? null,
      date: toIso(t.date),
      durationSeconds: toSeconds(t.duration),
      status,
      itemCount: known?.itemCount ?? 0,
      unifiedEventId: known?.unifiedEventId ?? null
    };
  });

  // When the upstream list failed, fall back to what we hold so the page still
  // has content — the whole point of storing transcripts locally.
  if (listError && meetings.length === 0) {
    const stored = await db
      .select({
        firefliesId: transcript.firefliesId,
        title: transcript.title,
        meetingDate: transcript.meetingDate,
        durationSeconds: transcript.durationSeconds
      })
      .from(transcript)
      .orderBy(desc(transcript.meetingDate))
      .limit(limit);

    const localStored = await localStateFor(stored.map((s) => s.firefliesId));
    for (const s of stored) {
      const known = localStored.get(s.firefliesId);
      meetings.push({
        firefliesId: s.firefliesId,
        title: s.title,
        date: s.meetingDate?.toISOString() ?? null,
        durationSeconds: s.durationSeconds,
        status: (known?.itemCount ?? 0) > 0 ? 'extracted' : 'extracted_empty',
        itemCount: known?.itemCount ?? 0,
        unifiedEventId: known?.unifiedEventId ?? null
      });
    }
  }

  return { meetings, ...(listError ? { listError } : {}) };
}

/**
 * Where an extraction has got to.
 *
 * ⚠️ Reads pg-boss's OWN table, which is the only place that distinguishes
 * "still queued" from "ran and found nothing". Both look identical from
 * candidate_action_item — zero rows — and conflating them is exactly the failure
 * the UI must avoid: an empty meeting would spin forever, or a queued one would
 * announce "no action items" before the model had seen it.
 *
 * pg-boss columns are snake_case (`created_on`, `completed_on`), unlike our
 * camelCase Drizzle models, and its `data` column is JSONB.
 */
export async function getExtractionStatus(firefliesId: string): Promise<ExtractionStatusResponse> {
  await requireUser();

  const [event] = await db
    .select({ id: unifiedEvent.id })
    .from(unifiedEvent)
    .where(sql`${unifiedEvent.subjectId} = ${firefliesId} and ${unifiedEvent.source} = 'fireflies'`)
    .orderBy(desc(unifiedEvent.occurredAt))
    .limit(1);

  if (!event) {
    return { firefliesId, state: 'unknown', itemCount: 0, unifiedEventId: null };
  }

  const counted = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(candidateActionItem)
    .where(eq(candidateActionItem.unifiedEventId, event.id));
  const itemCount = counted[0]?.n ?? 0;

  // Items exist -> done, regardless of what the queue says.
  if (itemCount > 0) {
    return { firefliesId, state: 'complete', itemCount, unifiedEventId: event.id };
  }

  const jobs = await db.execute<{ state: string; output: unknown }>(sql`
    select state, output
    from pgboss.job
    where name = 'extract.action-items'
      and data->>'unifiedEventId' = ${event.id}
    order by created_on desc
    limit 1
  `);

  const job = jobs.rows[0];
  if (!job) {
    // No job on record. Either it was never enqueued or pg-boss has archived it
    // (completed jobs move out of `job` after their retention window).
    return { firefliesId, state: 'unknown', itemCount: 0, unifiedEventId: event.id };
  }

  if (['created', 'active', 'retry'].includes(job.state)) {
    return { firefliesId, state: 'pending', itemCount: 0, unifiedEventId: event.id };
  }

  if (job.state === 'completed') {
    // Completed with zero items is a REAL, correct answer — a meeting with no
    // commitments in it. Reported as its own state so the UI can say so plainly
    // rather than implying the run failed.
    const out = job.output as { skipped?: string } | null;
    return {
      firefliesId,
      state: 'complete_empty',
      itemCount: 0,
      unifiedEventId: event.id,
      ...(out?.skipped ? { message: out.skipped } : {})
    };
  }

  const out = job.output as { message?: string } | null;
  return {
    firefliesId,
    state: 'failed',
    itemCount: 0,
    unifiedEventId: event.id,
    message: out?.message ?? `extraction job ${job.state}`
  };
}

const OWNER_CONFIDENCES: OwnerConfidenceLevel[] = ['exact', 'email', 'fuzzy', 'unresolved'];

function toOwnerConfidence(value: string): OwnerConfidenceLevel {
  return (OWNER_CONFIDENCES as string[]).includes(value)
    ? (value as OwnerConfidenceLevel)
    : 'unresolved';
}

/** One meeting, with every candidate action item extracted from it. */
export async function getExtractionDetail(firefliesId: string): Promise<ExtractionDetail | null> {
  await requireUser();

  const [row] = await db
    .select({
      firefliesId: transcript.firefliesId,
      title: transcript.title,
      meetingDate: transcript.meetingDate,
      durationSeconds: transcript.durationSeconds,
      payload: transcript.payload
    })
    .from(transcript)
    .where(eq(transcript.firefliesId, firefliesId))
    .limit(1);

  if (!row) return null;

  const payload = row.payload as {
    speakers?: { name?: string | null }[];
    sentences?: unknown[];
  };

  const speakers = [
    ...new Set(
      (payload.speakers ?? []).map((s) => s.name?.trim()).filter((n): n is string => Boolean(n))
    )
  ];

  const [event] = await db
    .select({ id: unifiedEvent.id })
    .from(unifiedEvent)
    .where(sql`${unifiedEvent.subjectId} = ${firefliesId} and ${unifiedEvent.source} = 'fireflies'`)
    .orderBy(desc(unifiedEvent.occurredAt))
    .limit(1);

  const items: ActionItemRow[] = event
    ? (
        await db
          .select({
            id: candidateActionItem.id,
            description: candidateActionItem.description,
            ownerName: candidateActionItem.ownerName,
            ownerPersonId: candidateActionItem.ownerPersonId,
            ownerPersonName: person.name,
            ownerConfidence: candidateActionItem.ownerConfidence,
            dueDate: candidateActionItem.dueDate,
            confidence: candidateActionItem.confidence,
            sourceSpan: candidateActionItem.sourceSpan,
            followUps: candidateActionItem.followUps,
            reviewStatus: candidateActionItem.reviewStatus,
            editedFields: candidateActionItem.editedFields,
            createdAt: candidateActionItem.createdAt
          })
          .from(candidateActionItem)
          .leftJoin(person, eq(person.id, candidateActionItem.ownerPersonId))
          .where(eq(candidateActionItem.unifiedEventId, event.id))
          .orderBy(desc(candidateActionItem.confidence))
      ).map((i) => ({
        ...i,
        ownerConfidence: toOwnerConfidence(i.ownerConfidence),
        dueDate: i.dueDate ?? null,
        createdAt: i.createdAt.toISOString()
      }))
    : [];

  return {
    firefliesId: row.firefliesId,
    title: row.title,
    date: row.meetingDate?.toISOString() ?? null,
    durationSeconds: row.durationSeconds,
    speakers,
    sentenceCount: (payload.sentences ?? []).length,
    unifiedEventId: event?.id ?? null,
    items,
    // "Stored, but no items and no completed extraction yet." Distinguished from
    // a genuine empty result by the caller polling until the job settles.
    pending: Boolean(event) && items.length === 0
  };
}

// ── Review: approve / reject ────────────────────────────────────────────────

/**
 * Approve a candidate and promote it to a tracked_item, in ONE transaction.
 *
 * ── Why one transaction ─────────────────────────────────────────────────────
 * The two writes are a single fact: "a human accepted this, and here is the
 * work it became." Split apart, a crash between them leaves either an approved
 * candidate that produced nothing — invisible, and the reviewer believes it is
 * done — or an orphan tracked_item whose candidate still sits in the queue,
 * waiting to be approved a second time.
 *
 * ── Destination-agnostic, deliberately ──────────────────────────────────────
 * The Command Centre is the task system of record (amendment 2026-08-04).
 * `source_system='internal'` and `external_task_id` stays NULL — required by
 * tracked_item_external_ref_ck, and correct: this row mirrors nothing. A future
 * read-only Notion/Ocean mirror records its own reference; see the
 * external_task_id semantics note in CLAUDE.md. NOTHING here writes to any
 * external system.
 */
export async function approveCandidate(input: unknown): Promise<ReviewResult> {
  await requireUser();

  const parsed = approveCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Invalid input'
    };
  }
  const { candidateId, edits } = parsed.data;
  const reviewer = await actorLabel();

  return db.transaction(async (tx) => {
    // ⚠️ FOR UPDATE. Two clicks race otherwise: both read 'pending', both insert,
    // and one candidate becomes two tracked items. The partial unique index on
    // tracked_item.candidate_action_item_id is the backstop; this lock is what
    // turns the second click into a clean "already decided" instead of a
    // constraint violation the UI has to interpret.
    const [candidate] = await tx
      .select()
      .from(candidateActionItem)
      .where(eq(candidateActionItem.id, candidateId))
      .limit(1)
      .for('update');

    if (!candidate) {
      return { ok: false, reason: 'not_found', message: 'Candidate not found' } as const;
    }
    if (candidate.reviewStatus !== 'pending') {
      return {
        ok: false,
        reason: 'already_decided',
        currentStatus: candidate.reviewStatus
      } as const;
    }

    // Which source produced this, for the project rule.
    const [event] = await tx
      .select({ source: unifiedEvent.source, subjectId: unifiedEvent.subjectId })
      .from(unifiedEvent)
      .where(eq(unifiedEvent.id, candidate.unifiedEventId))
      .limit(1);

    const projectName = promotionProjectFor(event?.source);

    // Get-or-create by name, inside the transaction. `project` has no UNIQUE on
    // name, so this is an explicit lookup — same approach as the seed.
    let [proj] = await tx
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(eq(project.name, projectName))
      .limit(1);

    if (!proj) {
      [proj] = await tx
        .insert(project)
        .values({
          name: projectName,
          description: projectName === FALLBACK_PROJECT_NAME ? INBOX_PROJECT_DESCRIPTION : null,
          status: 'active'
        })
        .returning({ id: project.id, name: project.name });
    }

    // Resolve edits against the model's values, and record WHICH changed.
    const description = edits?.description ?? candidate.description;
    const ownerPersonId =
      edits?.ownerPersonId !== undefined ? edits.ownerPersonId : candidate.ownerPersonId;
    const dueDateIso = edits?.dueDate !== undefined ? edits.dueDate : candidate.dueDate;

    const editedFields: string[] = [];
    if (edits?.description !== undefined && edits.description !== candidate.description) {
      editedFields.push('description');
    }
    if (edits?.ownerPersonId !== undefined && edits.ownerPersonId !== candidate.ownerPersonId) {
      editedFields.push('owner');
    }
    if (edits?.dueDate !== undefined && edits.dueDate !== candidate.dueDate) {
      editedFields.push('due_date');
    }

    const [item] = await tx
      .insert(trackedItem)
      .values({
        projectId: proj.id,
        candidateActionItemId: candidate.id,
        // The Command Centre owns this content — see the header.
        sourceSystem: 'internal',
        externalTaskId: null,
        sourceType: 'meeting',
        sourceRef: event?.subjectId ?? null,
        title: description,
        ownerPersonId,
        dueDate: dueDateIso ? new Date(`${dueDateIso}T00:00:00Z`) : null,
        status: 'open',
        lastUpdateAt: new Date()
      })
      .returning({ id: trackedItem.id });

    // ⚠️ The candidate keeps the MODEL's description, owner and due date.
    // Corrections live on the tracked_item above; edited_fields names what was
    // wrong. Writing them back would erase what the model actually produced and
    // make the precision metric unanswerable.
    await tx
      .update(candidateActionItem)
      .set({
        reviewStatus: 'approved',
        reviewedBy: reviewer,
        reviewedAt: new Date(),
        editedFields
      })
      .where(eq(candidateActionItem.id, candidate.id));

    return {
      ok: true,
      status: 'approved',
      editedFields,
      promoted: {
        trackedItemId: item.id,
        projectId: proj.id,
        projectName: proj.name,
        title: description
      }
    } as const;
  });
}

/** Reject: status only. No tracked_item, nothing promoted. */
export async function rejectCandidate(input: unknown): Promise<ReviewResult> {
  await requireUser();

  const parsed = rejectCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Invalid input'
    };
  }
  const reviewer = await actorLabel();

  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: candidateActionItem.id, reviewStatus: candidateActionItem.reviewStatus })
      .from(candidateActionItem)
      .where(eq(candidateActionItem.id, parsed.data.candidateId))
      .limit(1)
      .for('update');

    if (!candidate) {
      return { ok: false, reason: 'not_found', message: 'Candidate not found' } as const;
    }
    if (candidate.reviewStatus !== 'pending') {
      return {
        ok: false,
        reason: 'already_decided',
        currentStatus: candidate.reviewStatus
      } as const;
    }

    // review_provenance_ck requires BOTH reviewed_by and reviewed_at for
    // 'rejected', same as 'approved' — a rejection is a decision someone owns.
    await tx
      .update(candidateActionItem)
      .set({ reviewStatus: 'rejected', reviewedBy: reviewer, reviewedAt: new Date() })
      .where(eq(candidateActionItem.id, candidate.id));

    return { ok: true, status: 'rejected' } as const;
  });
}
