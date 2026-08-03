/**
 * Tracker seed: projects and the work under them.
 *
 * ⚠️ THE BOARD MUST RENDER POPULATED ON FIRST DEMO. `tracked_item` had zero
 * rows and no writers, so without this the tracker is an empty shell — which is
 * the one outcome the increment was specified to avoid.
 *
 * ── Rules this seed obeys ───────────────────────────────────────────────────
 *
 * 1. PLACEHOLDER TASK TEXT ONLY. No transcript content, no real commitments,
 *    nothing said in an actual meeting. This repo is PUBLIC.
 * 2. REAL roster only. People are looked up by name from `person`; nobody is
 *    invented, and a missing name is a hard error rather than a silent skip —
 *    a board seeded against half the team looks fine and is wrong.
 * 3. `source_system = 'internal'` with `external_task_id` NULL, per
 *    `tracked_item_external_ref_ck`. Seeding a fake ClickUp/Notion id would
 *    point at nothing and 404 the moment the origin link was clicked.
 * 4. Dates are relative to run time, so the board still has overdue work
 *    whenever it is re-seeded rather than only in the week it was written.
 * 5. Idempotent — keyed on (project_id, title), so re-running updates rather
 *    than duplicating.
 */

import { and, eq } from 'drizzle-orm';
import { db } from './index';
import { person, project, trackedItem } from './schema';
import type { TrackedItemStatus } from './schema/tracked-item';

type SeedProject = {
  name: string;
  description: string;
  status: 'active' | 'paused' | 'complete' | 'archived';
  leadName: string;
};

export const SEED_PROJECTS: SeedProject[] = [
  {
    name: 'Command Center',
    description:
      'The internal operations portal itself — ingestion, identity resolution, extraction and this tracker.',
    status: 'active',
    leadName: 'Sami'
  },
  {
    name: 'Studio / UGC Platform',
    description: 'Creator pipeline, studio stats and the UGC portal integration.',
    status: 'active',
    leadName: 'Ardin'
  },
  {
    name: 'Content Operations',
    description: 'Briefs, publishing cadence and the content team’s recurring workflow.',
    status: 'active',
    leadName: 'Hashim'
  }
];

/** Days from today. Negative = overdue. Null = no date. */
type SeedItem = {
  title: string;
  description?: string;
  ownerName: string | null;
  status: TrackedItemStatus;
  dueInDays: number | null;
  riskFlag?: boolean;
};

const ITEMS: Record<string, SeedItem[]> = {
  'Command Center': [
    {
      title: 'Wire the review queue to approve and reject candidates',
      ownerName: 'Sami',
      status: 'in_progress',
      dueInDays: 3
    },
    {
      title: 'Notion sync for approved action items',
      ownerName: 'Sami',
      status: 'open',
      dueInDays: 6
    },
    {
      title: 'Backfill identities for unresolved Slack accounts',
      ownerName: 'Usama',
      status: 'open',
      dueInDays: -2
    },
    {
      title: 'Per-person profile pages with AI summaries',
      ownerName: 'Usama',
      status: 'open',
      dueInDays: 9
    },
    {
      title: 'Harden webhook replay protection for Vision',
      ownerName: 'Sami',
      status: 'blocked',
      dueInDays: -5,
      riskFlag: true,
      description: 'Waiting on a timestamp header from the Vision team.'
    },
    {
      title: 'Rate-limit headroom logging for Slack',
      ownerName: 'Usama',
      status: 'done',
      dueInDays: -8
    },
    { title: 'Extraction eval harness', ownerName: 'Sami', status: 'done', dueInDays: -1 },
    {
      title: 'Decide on a single date-formatting convention',
      ownerName: null,
      status: 'open',
      dueInDays: null
    },
    {
      title: 'Deploy the extraction worker to Railway',
      ownerName: 'Sami',
      status: 'open',
      dueInDays: 1,
      riskFlag: true
    },
    {
      title: 'Retire the temporary Sentry check route',
      ownerName: 'Usama',
      status: 'open',
      dueInDays: 12
    }
  ],
  'Studio / UGC Platform': [
    {
      title: 'Point-lookup client for backend order endpoints',
      ownerName: 'Usama',
      status: 'open',
      dueInDays: 5
    },
    {
      title: 'Creator onboarding checklist in the portal',
      ownerName: 'Ardin',
      status: 'in_progress',
      dueInDays: -1
    },
    { title: 'Studio stats API contract review', ownerName: 'Ardin', status: 'open', dueInDays: 8 },
    {
      title: 'Map portal actor ids to person records',
      ownerName: 'Sami',
      status: 'open',
      dueInDays: -4
    },
    {
      title: 'Weekly creator payout reconciliation',
      ownerName: 'Ronalyn',
      status: 'in_progress',
      dueInDays: 2
    },
    {
      title: 'Archive the legacy uploader',
      ownerName: 'Usama',
      status: 'cancelled',
      dueInDays: -20
    },
    { title: 'Draft the creator tiering rules', ownerName: null, status: 'open', dueInDays: null },
    { title: 'Portal webhook signature rotation', ownerName: 'Sami', status: 'done', dueInDays: -6 }
  ],
  'Content Operations': [
    { title: 'September content brief', ownerName: 'Hashim', status: 'in_progress', dueInDays: 4 },
    {
      title: 'Clear the unedited podcast backlog',
      ownerName: 'Diane',
      status: 'open',
      dueInDays: -3
    },
    {
      title: 'Pricing page copy refresh',
      ownerName: 'Hashim',
      status: 'blocked',
      dueInDays: -7,
      riskFlag: true,
      description: 'Blocked on design sign-off.'
    },
    { title: 'Publishing cadence retro', ownerName: 'Damian', status: 'open', dueInDays: 10 },
    { title: 'Refresh the brand style guide', ownerName: null, status: 'open', dueInDays: null },
    { title: 'Competitor content audit', ownerName: 'Diane', status: 'open', dueInDays: 14 },
    { title: 'Q3 performance summary', ownerName: 'Damian', status: 'done', dueInDays: -2 }
  ]
};

function daysFromNow(days: number | null, now: Date): Date | null {
  if (days === null) return null;
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function seedTracker(now: Date = new Date()): Promise<{
  projects: number;
  items: number;
}> {
  const people = await db.select({ id: person.id, name: person.name }).from(person);
  const byName = new Map(people.map((p) => [p.name, p.id]));

  function personId(name: string | null): string | null {
    if (name === null) return null;
    const id = byName.get(name);
    if (!id) {
      // Hard failure, not a skip. A board seeded against a partial roster looks
      // populated and quietly misattributes work.
      throw new Error(
        `Seed roster mismatch: no person named "${name}". Run the main seed first (pnpm db:seed).`
      );
    }
    return id;
  }

  let itemCount = 0;

  for (const sp of SEED_PROJECTS) {
    const leadPersonId = personId(sp.leadName);

    // Keyed on name — project has no UNIQUE on it, so this is an explicit
    // lookup rather than onConflictDoUpdate. Same approach as the main seed.
    const [existing] = await db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.name, sp.name))
      .limit(1);

    let projectId: string;
    if (existing) {
      await db
        .update(project)
        .set({ description: sp.description, status: sp.status, leadPersonId })
        .where(eq(project.id, existing.id));
      projectId = existing.id;
    } else {
      const [created] = await db
        .insert(project)
        .values({ name: sp.name, description: sp.description, status: sp.status, leadPersonId })
        .returning({ id: project.id });
      projectId = created.id;
    }

    for (const it of ITEMS[sp.name] ?? []) {
      const values = {
        projectId,
        // ⚠️ 'internal' with a NULL external_task_id — required by
        // tracked_item_external_ref_ck, and honest: these are not mirrors of
        // anything, so an invented ClickUp id would 404 on first click.
        sourceSystem: 'internal' as const,
        externalTaskId: null,
        sourceType: 'manual' as const,
        title: it.title,
        description: it.description ?? null,
        ownerPersonId: personId(it.ownerName),
        status: it.status,
        dueDate: daysFromNow(it.dueInDays, now),
        riskFlag: it.riskFlag ?? false,
        lastUpdateAt: now
      };

      const [row] = await db
        .select({ id: trackedItem.id })
        .from(trackedItem)
        .where(and(eq(trackedItem.projectId, projectId), eq(trackedItem.title, it.title)))
        .limit(1);

      if (row) await db.update(trackedItem).set(values).where(eq(trackedItem.id, row.id));
      else await db.insert(trackedItem).values(values);

      itemCount += 1;
    }
  }

  return { projects: SEED_PROJECTS.length, items: itemCount };
}
