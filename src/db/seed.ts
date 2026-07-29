/**
 * Seed script — `pnpm db:seed`
 *
 * IDEMPOTENT. Safe to re-run: every write is a lookup on a natural identifier
 * followed by an insert or update, never a blind insert. Re-running updates
 * existing rows in place and leaves row counts unchanged.
 *
 * There are no UNIQUE constraints on the natural keys yet (only primary keys),
 * so `onConflictDoUpdate` is not available — hence the explicit lookup. If a
 * UNIQUE index is added to role_profile.name later, this can be simplified to a
 * real upsert.
 *
 * Scope: role_profile, person, recurring_task.
 *   - tracked_item is deliberately NOT seeded. It requires a real
 *     clickup_task_id, and ClickUp is the system of record — an invented id
 *     would reference nothing and 404 the moment code resolved it.
 *   - completion_event and raw_event are left empty; they are produced by
 *     ingestion, not by seeding.
 */

import { eq } from 'drizzle-orm';
import { db, pool } from './index';
import { person, recurringTask, roleProfile } from './schema';

// ── Role profiles (PRD §5.3) ─────────────────────────────────────────────────
// quota_config is left {} wherever the PRD states "vs quota" without giving a
// number. Inventing a quota here would silently drive a monitor off fabricated
// data — better to leave it empty and fail loudly when a real number is needed.

const ROLE_PROFILES = [
  {
    name: 'CX agent',
    trackedSignals: ['ticket_volume', 'comments', 'resolutions'],
    quotaConfig: {},
    sourceChannels: ['zendesk']
  },
  {
    name: 'Ops / leadership',
    trackedSignals: [
      'action_items',
      'recurring_daily_operational_tasks',
      'delivery_volume',
      'delivery_cadence'
    ],
    quotaConfig: {},
    sourceChannels: ['slack', 'clickup']
  },
  {
    name: 'Creative strategist',
    trackedSignals: ['briefs_submitted_per_week'],
    quotaConfig: {}, // PRD: "vs quota" — number TBD
    sourceChannels: ['brief_tracker']
  },
  {
    name: 'Video editor',
    trackedSignals: ['edits_submitted', 'videos_submitted'],
    quotaConfig: {}, // PRD: "vs quota" — number TBD
    sourceChannels: ['brief_tracker']
  },
  {
    name: 'Engineer',
    trackedSignals: [
      'assigned_projects',
      'assigned_tasks',
      'timelines',
      'progress',
      'work_in_flight'
    ],
    quotaConfig: {},
    sourceChannels: ['clickup', 'slack']
  },
  {
    name: 'Agency',
    trackedSignals: ['slack_updates', 'klaviyo_metrics'],
    quotaConfig: {},
    sourceChannels: ['slack', 'klaviyo']
  },
  {
    // Seventh profile — not in PRD §5.3. A founder is the consumer of these
    // signals rather than the subject of them, so measuring personal throughput
    // (as "Ops / leadership" does) would be the wrong model.
    name: 'Founder / Leadership',
    trackedSignals: ['escalations', 'at_risk_items', 'weekly_digest'],
    quotaConfig: {},
    sourceChannels: ['slack']
  }
] as const;

// ── Team roster (PRD §4) ─────────────────────────────────────────────────────
// External ids seed as NULL, not placeholders: the columns are nullable by
// design, `WHERE slack_id IS NULL` answers "who still needs mapping?", and a
// placeholder string is truthy — any `if (person.slackId)` would treat it as
// real and hand it to the Slack API.

const PEOPLE = [
  { name: 'Damian', roleProfileName: 'Founder / Leadership' },
  { name: 'Ardin', roleProfileName: 'Ops / leadership' },
  { name: 'Ronalyn', roleProfileName: 'CX agent' },
  { name: 'Diane', roleProfileName: 'CX agent' },
  { name: 'Hashim', roleProfileName: 'Creative strategist' },
  { name: 'Usama', roleProfileName: 'Engineer' }
] as const;

// ── Recurring tasks ──────────────────────────────────────────────────────────
// NOTE: recurring_task has no title/label column, so the natural identifier is
// (owner_person_id, auto_complete_rule.event). That pair is what makes this
// section idempotent.

const RECURRING_TASKS = [
  {
    ownerName: 'Ronalyn',
    cadence: 'daily',
    autoCompleteRule: { source: 'portal', event: 'returns_acknowledged', within: '24h' },
    fallbackManual: true
  },
  {
    ownerName: 'Diane',
    cadence: 'daily',
    autoCompleteRule: { source: 'zendesk', event: 'queue_cleared', within: '24h' },
    fallbackManual: true
  },
  {
    ownerName: 'Ardin',
    cadence: 'weekly',
    autoCompleteRule: { source: 'slack', event: 'ops_review_posted', within: '7d' },
    fallbackManual: false
  },
  {
    ownerName: 'Hashim',
    cadence: 'weekly',
    autoCompleteRule: { source: 'brief_tracker', event: 'briefs_submitted', within: '7d' },
    fallbackManual: false
  },
  {
    ownerName: 'Usama',
    cadence: 'weekly',
    autoCompleteRule: { source: 'clickup', event: 'progress_updated', within: '7d' },
    fallbackManual: false
  }
] as const;

async function seed() {
  const profileIds = new Map<string, string>();

  await db.transaction(async (tx) => {
    // role_profile — keyed on name
    for (const p of ROLE_PROFILES) {
      const [existing] = await tx
        .select({ id: roleProfile.id })
        .from(roleProfile)
        .where(eq(roleProfile.name, p.name))
        .limit(1);

      if (existing) {
        await tx
          .update(roleProfile)
          .set({
            trackedSignals: [...p.trackedSignals],
            quotaConfig: p.quotaConfig,
            sourceChannels: [...p.sourceChannels]
          })
          .where(eq(roleProfile.id, existing.id));
        profileIds.set(p.name, existing.id);
      } else {
        const [created] = await tx
          .insert(roleProfile)
          .values({
            name: p.name,
            trackedSignals: [...p.trackedSignals],
            quotaConfig: p.quotaConfig,
            sourceChannels: [...p.sourceChannels]
          })
          .returning({ id: roleProfile.id });
        profileIds.set(p.name, created.id);
      }
    }

    // person — keyed on name
    const personIds = new Map<string, string>();

    for (const pr of PEOPLE) {
      const roleProfileId = profileIds.get(pr.roleProfileName);
      if (!roleProfileId) {
        throw new Error(`No role_profile named "${pr.roleProfileName}" for ${pr.name}`);
      }

      const [existing] = await tx
        .select({ id: person.id })
        .from(person)
        .where(eq(person.name, pr.name))
        .limit(1);

      if (existing) {
        // Only the profile link is managed here. External ids are left exactly
        // as they are, so a real slack_id added by hand is never clobbered.
        await tx.update(person).set({ roleProfileId }).where(eq(person.id, existing.id));
        personIds.set(pr.name, existing.id);
      } else {
        const [created] = await tx
          .insert(person)
          .values({
            name: pr.name,
            roleProfileId,
            slackId: null,
            clickupId: null,
            portalId: null
          })
          .returning({ id: person.id });
        personIds.set(pr.name, created.id);
      }
    }

    // recurring_task — keyed on (owner_person_id, auto_complete_rule.event)
    for (const rt of RECURRING_TASKS) {
      const ownerPersonId = personIds.get(rt.ownerName);
      if (!ownerPersonId) throw new Error(`No person named "${rt.ownerName}"`);

      const owned = await tx
        .select({ id: recurringTask.id, rule: recurringTask.autoCompleteRule })
        .from(recurringTask)
        .where(eq(recurringTask.ownerPersonId, ownerPersonId));

      const match = owned.find(
        (row) => (row.rule as { event?: string } | null)?.event === rt.autoCompleteRule.event
      );

      if (match) {
        await tx
          .update(recurringTask)
          .set({
            cadence: rt.cadence,
            autoCompleteRule: rt.autoCompleteRule,
            fallbackManual: rt.fallbackManual
          })
          .where(eq(recurringTask.id, match.id));
      } else {
        await tx.insert(recurringTask).values({
          ownerPersonId,
          cadence: rt.cadence,
          autoCompleteRule: rt.autoCompleteRule,
          fallbackManual: rt.fallbackManual
        });
      }
    }
  });

  // Report
  const counts = await Promise.all(
    [
      ['role_profile', roleProfile],
      ['person', person],
      ['recurring_task', recurringTask]
    ].map(async ([label, table]) => {
      const rows = await db.select({ id: (table as typeof roleProfile).id }).from(table as never);
      return [label as string, rows.length] as const;
    })
  );

  console.log('\n  Seed complete:');
  for (const [label, n] of counts) {
    console.log(`    ${label.padEnd(16)} ${n} rows`);
  }
}

seed()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n  Seed failed:', err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
