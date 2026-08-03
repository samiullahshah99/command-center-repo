/**
 * The ONE hardcoded data source behind all three mockups.
 *
 * ⚠️ STATIC FIXTURES. Nothing here touches the database, and nothing here is
 * real work. Task titles are invented in the same register as the seed —
 * infrastructure, creator pipeline, content ops — so the screenshots read as
 * plausible without quoting anything anyone actually said.
 *
 * What IS real: the three project names and the seven first names, both taken
 * from the seeded roster, so leadership recognises the board as theirs.
 *
 * What is deliberately NOT here: transcript content, external-party or client
 * names, email addresses, anything from a real meeting. These pages live in a
 * PUBLIC repo.
 *
 * Every date is derived from MOCKUP_TODAY — see the warning in ./constants.ts
 * about why that is a mockup-only convention.
 */

import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import { fromToday } from './constants';

// ── People ──────────────────────────────────────────────────────────────────

export type MockPerson = {
  name: string;
  /** Role profile name, matching the seeded roster. */
  role: string;
  initials: string;
};

export const PEOPLE: MockPerson[] = [
  { name: 'Damian', role: 'Founder / Leadership', initials: 'DA' },
  { name: 'Ardin', role: 'Ops / Leadership', initials: 'AR' },
  { name: 'Hashim', role: 'Creative strategist', initials: 'HA' },
  { name: 'Diane', role: 'CX agent', initials: 'DI' },
  { name: 'Ronalyn', role: 'CX agent', initials: 'RO' },
  { name: 'Usama', role: 'Engineer', initials: 'US' },
  { name: 'Sami', role: 'Engineer', initials: 'SA' }
];

export function personByName(name: string): MockPerson | null {
  return PEOPLE.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null;
}

// ── Projects ────────────────────────────────────────────────────────────────

export type MockProject = {
  id: string;
  name: string;
  /** Tailwind classes for the project's accent, used on tags and timeline bands. */
  accent: string;
  dot: string;
};

export const PROJECTS: MockProject[] = [
  {
    id: 'command-center',
    name: 'Command Center',
    accent: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    dot: 'bg-violet-500'
  },
  {
    id: 'studio-ugc',
    name: 'Studio / UGC Platform',
    accent: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
    dot: 'bg-cyan-500'
  },
  {
    id: 'content-ops',
    name: 'Content Operations',
    accent: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
    dot: 'bg-orange-500'
  }
];

export function projectById(id: string): MockProject {
  const p = PROJECTS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown mock project: ${id}`);
  return p;
}

// ── Items ───────────────────────────────────────────────────────────────────

export type MockItem = {
  id: string;
  title: string;
  projectId: string;
  /** null = unassigned, which the kanban and timeline both surface explicitly. */
  owner: string | null;
  status: TrackedItemStatus;
  /** ISO date. null = no date; parked on the timeline, no chip on the card. */
  dueDate: string | null;
  /** ISO date the bar starts from on the roadmap. Defaults to a week before due. */
  startDate: string | null;
  riskFlag?: boolean;
};

/**
 * ~30 items, shaped so every view has something to show:
 *   - each status lane is non-empty on the kanban
 *   - each project has overdue work, so the timeline bleeds left in all bands
 *   - each person has a mix, so any ?person= choice looks populated
 *   - a handful are unassigned or undated, for the parked row
 */
export const ITEMS: MockItem[] = [
  // ── Command Center ────────────────────────────────────────────────────────
  {
    id: 'cc-1',
    title: 'Review queue: approve and reject candidates',
    projectId: 'command-center',
    owner: 'Sami',
    status: 'in_progress',
    startDate: fromToday(-4),
    dueDate: fromToday(3)
  },
  {
    id: 'cc-2',
    title: 'Notion sync for approved action items',
    projectId: 'command-center',
    owner: 'Sami',
    status: 'open',
    startDate: fromToday(2),
    dueDate: fromToday(9)
  },
  {
    id: 'cc-3',
    title: 'Backfill identities for unresolved Slack accounts',
    projectId: 'command-center',
    owner: 'Usama',
    status: 'open',
    startDate: fromToday(-9),
    dueDate: fromToday(-2),
    riskFlag: true
  },
  {
    id: 'cc-4',
    title: 'Per-person profile pages with AI summaries',
    projectId: 'command-center',
    owner: 'Usama',
    status: 'open',
    startDate: fromToday(5),
    dueDate: fromToday(14)
  },
  {
    id: 'cc-5',
    title: 'Replay protection for the Vision webhook',
    projectId: 'command-center',
    owner: 'Sami',
    status: 'blocked',
    startDate: fromToday(-14),
    dueDate: fromToday(-6),
    riskFlag: true
  },
  {
    id: 'cc-6',
    title: 'Rate-limit headroom logging',
    projectId: 'command-center',
    owner: 'Usama',
    status: 'done',
    startDate: fromToday(-18),
    dueDate: fromToday(-10)
  },
  {
    id: 'cc-7',
    title: 'Extraction eval harness',
    projectId: 'command-center',
    owner: 'Sami',
    status: 'done',
    startDate: fromToday(-12),
    dueDate: fromToday(-1)
  },
  {
    id: 'cc-8',
    title: 'Single date-formatting convention',
    projectId: 'command-center',
    owner: null,
    status: 'open',
    startDate: null,
    dueDate: null
  },
  {
    id: 'cc-9',
    title: 'Deploy the extraction worker',
    projectId: 'command-center',
    owner: 'Sami',
    status: 'open',
    startDate: fromToday(-1),
    dueDate: fromToday(1),
    riskFlag: true
  },
  {
    id: 'cc-10',
    title: 'Retire the temporary Sentry check route',
    projectId: 'command-center',
    owner: 'Usama',
    status: 'open',
    startDate: fromToday(10),
    dueDate: fromToday(17)
  },
  {
    id: 'cc-11',
    title: 'Weekly ops digest to leadership',
    projectId: 'command-center',
    owner: 'Ardin',
    status: 'in_progress',
    startDate: fromToday(-2),
    dueDate: fromToday(2)
  },

  // ── Studio / UGC Platform ─────────────────────────────────────────────────
  {
    id: 'ug-1',
    title: 'Point-lookup client for order endpoints',
    projectId: 'studio-ugc',
    owner: 'Usama',
    status: 'open',
    startDate: fromToday(-1),
    dueDate: fromToday(6)
  },
  {
    id: 'ug-2',
    title: 'Creator onboarding checklist',
    projectId: 'studio-ugc',
    owner: 'Ardin',
    status: 'in_progress',
    startDate: fromToday(-8),
    dueDate: fromToday(-1),
    riskFlag: true
  },
  {
    id: 'ug-3',
    title: 'Studio stats API contract review',
    projectId: 'studio-ugc',
    owner: 'Ardin',
    status: 'open',
    startDate: fromToday(4),
    dueDate: fromToday(11)
  },
  {
    id: 'ug-4',
    title: 'Map portal actor ids to people',
    projectId: 'studio-ugc',
    owner: 'Sami',
    status: 'open',
    startDate: fromToday(-11),
    dueDate: fromToday(-4)
  },
  {
    id: 'ug-5',
    title: 'Weekly creator payout reconciliation',
    projectId: 'studio-ugc',
    owner: 'Ronalyn',
    status: 'in_progress',
    startDate: fromToday(-3),
    dueDate: fromToday(2)
  },
  {
    id: 'ug-6',
    title: 'Archive the legacy uploader',
    projectId: 'studio-ugc',
    owner: 'Usama',
    status: 'cancelled',
    startDate: fromToday(-30),
    dueDate: fromToday(-22)
  },
  {
    id: 'ug-7',
    title: 'Creator tiering rules',
    projectId: 'studio-ugc',
    owner: null,
    status: 'open',
    startDate: null,
    dueDate: null
  },
  {
    id: 'ug-8',
    title: 'Portal webhook signature rotation',
    projectId: 'studio-ugc',
    owner: 'Sami',
    status: 'done',
    startDate: fromToday(-16),
    dueDate: fromToday(-8)
  },
  {
    id: 'ug-9',
    title: 'Creator response-time SLA dashboard',
    projectId: 'studio-ugc',
    owner: 'Ronalyn',
    status: 'open',
    startDate: fromToday(7),
    dueDate: fromToday(15)
  },
  {
    id: 'ug-10',
    title: 'Escalation path for flagged submissions',
    projectId: 'studio-ugc',
    owner: 'Diane',
    status: 'blocked',
    startDate: fromToday(-7),
    dueDate: fromToday(-3),
    riskFlag: true
  },

  // ── Content Operations ────────────────────────────────────────────────────
  {
    id: 'co-1',
    title: 'September content brief',
    projectId: 'content-ops',
    owner: 'Hashim',
    status: 'in_progress',
    startDate: fromToday(-3),
    dueDate: fromToday(4)
  },
  {
    id: 'co-2',
    title: 'Clear the unedited episode backlog',
    projectId: 'content-ops',
    owner: 'Diane',
    status: 'open',
    startDate: fromToday(-10),
    dueDate: fromToday(-3),
    riskFlag: true
  },
  {
    id: 'co-3',
    title: 'Pricing page copy refresh',
    projectId: 'content-ops',
    owner: 'Hashim',
    status: 'blocked',
    startDate: fromToday(-15),
    dueDate: fromToday(-7),
    riskFlag: true
  },
  {
    id: 'co-4',
    title: 'Publishing cadence retro',
    projectId: 'content-ops',
    owner: 'Damian',
    status: 'open',
    startDate: fromToday(6),
    dueDate: fromToday(13)
  },
  {
    id: 'co-5',
    title: 'Refresh the brand style guide',
    projectId: 'content-ops',
    owner: null,
    status: 'open',
    startDate: null,
    dueDate: null
  },
  {
    id: 'co-6',
    title: 'Competitor content audit',
    projectId: 'content-ops',
    owner: 'Diane',
    status: 'open',
    startDate: fromToday(9),
    dueDate: fromToday(18)
  },
  {
    id: 'co-7',
    title: 'Q3 performance summary',
    projectId: 'content-ops',
    owner: 'Damian',
    status: 'done',
    startDate: fromToday(-9),
    dueDate: fromToday(-2)
  },
  {
    id: 'co-8',
    title: 'Short-form pilot: first ten scripts',
    projectId: 'content-ops',
    owner: 'Hashim',
    status: 'open',
    startDate: fromToday(1),
    dueDate: fromToday(8)
  },
  {
    id: 'co-9',
    title: 'Caption style guide for social',
    projectId: 'content-ops',
    owner: 'Ronalyn',
    status: 'done',
    startDate: fromToday(-20),
    dueDate: fromToday(-12)
  },
  {
    id: 'co-10',
    title: 'Repurpose long-form into carousels',
    projectId: 'content-ops',
    owner: 'Diane',
    status: 'in_progress',
    startDate: fromToday(-1),
    dueDate: fromToday(5)
  }
];

// ── Derived helpers ─────────────────────────────────────────────────────────

export const TERMINAL: TrackedItemStatus[] = ['done', 'cancelled'];

export function isTerminalStatus(s: TrackedItemStatus): boolean {
  return TERMINAL.includes(s);
}

/** Overdue = past the reference date AND still live. Finished work is not late. */
export function isOverdue(item: MockItem, today: string): boolean {
  if (!item.dueDate || isTerminalStatus(item.status)) return false;
  return item.dueDate < today;
}

export function itemsFor(personName: string): MockItem[] {
  return ITEMS.filter((i) => i.owner === personName);
}

export function countsFor(personName: string, today: string) {
  const mine = itemsFor(personName);
  return {
    open: mine.filter((i) => !isTerminalStatus(i.status)).length,
    overdue: mine.filter((i) => isOverdue(i, today)).length,
    done: mine.filter((i) => i.status === 'done').length,
    total: mine.length
  };
}

// ── The mocked AI summaries ─────────────────────────────────────────────────

/**
 * ⚠️ STATIC PLACEHOLDER PROSE. Not generated, not derived from anything.
 *
 * Written to be plausible for each person's actual fixture items so the card
 * survives a close read in a screenshot — a summary that contradicts the list
 * beneath it is the first thing anyone notices. The UI labels it as static; see
 * ai-summary-card.tsx.
 */
export const AI_SUMMARIES: Record<string, string[]> = {
  Sami: [
    'Carrying the heaviest load on Command Center this cycle, with the review queue and the extraction worker both mid-flight.',
    'Two items are running late — the Vision replay protection has been blocked longest and is the one worth unblocking first.',
    'Delivery has been steady: the eval harness and the webhook signature rotation both closed on time.'
  ],
  Usama: [
    'Split across Command Center and the Studio platform, with most work still ahead of its due date.',
    'The identity backfill is the outlier — overdue and flagged, and nothing else is waiting on it.',
    'Closed the rate-limit logging work cleanly last cycle.'
  ],
  Hashim: [
    'Focused entirely on Content Operations, with the September brief the active piece.',
    'The pricing page copy has been blocked for over a week and is the longest-running stall on the board.',
    'The short-form pilot starts shortly and does not yet have a dependency on the blocked item.'
  ],
  Diane: [
    'Spread across content and creator escalations, with three live items.',
    'Two are past due — the episode backlog and the flagged-submission escalation path, the latter blocked externally.',
    'Carousel repurposing is on track and started this week.'
  ],
  Ronalyn: [
    'Steady cadence on creator operations, no overdue work.',
    'Payout reconciliation runs weekly and is currently mid-cycle.',
    'The SLA dashboard is queued for later this month.'
  ],
  Ardin: [
    'Operating across both leadership reporting and creator onboarding.',
    'The onboarding checklist slipped past its date this week and is the only late item.',
    'The stats API contract review is scheduled but not started.'
  ],
  Damian: [
    'Light load this cycle, weighted toward review rather than delivery.',
    'Nothing overdue; the publishing cadence retro is the next scheduled item.',
    'The Q3 performance summary closed on time.'
  ]
};
