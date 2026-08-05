/**
 * Agent-performance view types and vocabulary.
 *
 * ⚠️ PURE and client-safe. Lives in src/lib because two features build these rows
 * — My team and the CX department panel — and the shared component in
 * `@/components/agent-performance-table` renders them. CLAUDE.md puts shared
 * behaviour here rather than in an import between features.
 */

/**
 * ⚠️ ADHERENCE, NOT A SCHEDULE — a named trap from the audit.
 *
 * The mockup's "Cadence" column means *is this agent keeping up*.
 * `recurring_task.cadence` is a completely different concept: a REPETITION
 * INTERVAL (`daily | weekly | biweekly | monthly | quarterly`). Two different
 * things are called "cadence" on adjacent screens, so this type is named
 * `AgentCadence` and deliberately does NOT reuse `Cadence` from
 * `@/db/schema/recurring-task` — importing that one here would typecheck and mean
 * the wrong thing.
 */
export type AgentCadence = 'on_track' | 'behind' | 'ahead';

/**
 * One row.
 *
 * ⚠️ HYBRID. `personId` / `name` / `roleLabel` are REAL people. Every FIGURE —
 * tickets, resolved, csat, cadence — is INVENTED: Zendesk has no client, no
 * credentials and no table (audit §3.3).
 */
export type AgentRow = {
  personId: string;
  /** REAL — the person's name. */
  name: string;
  /** REAL — `role.display_name`, or null when no access role is assigned. */
  roleLabel: string | null;
  /** ⚠️ INVENTED. */
  tickets: number;
  /** ⚠️ INVENTED. */
  resolved: number;
  /** ⚠️ INVENTED. 0–5, one decimal. */
  csat: number;
  /** ⚠️ INVENTED. Adherence — see AgentCadence. */
  cadence: AgentCadence;
};

export type AgentPerformanceView = {
  /** ⚠️ Applies to the figures only; the agents themselves are real. */
  figuresAreSample: boolean;
  rows: AgentRow[];
};

/**
 * Adherence → label + tone.
 *
 * ⚠️ `ahead` is MUTED, not success. Green on "ahead" turns the table into a
 * leaderboard, and these are real colleagues — the only value worth colouring is
 * the one that needs action.
 */
export const AGENT_CADENCE_META: Record<AgentCadence, { label: string; tone: string }> = {
  on_track: { label: 'On track', tone: 'text-success-muted-foreground' },
  behind: { label: 'Behind', tone: 'text-destructive' },
  ahead: { label: 'Ahead', tone: 'text-muted-foreground' }
};

/**
 * TODO(backend): zendesk (audit §3.3).
 *
 * ⚠️ THE AGENTS ARE REAL; EVERY FIGURE IS INVENTED. Shared by both consumers so the
 * two screens cannot invent *different* numbers for the same person — which would
 * be worse than either set of numbers alone.
 *
 * ⚠️ DERIVED FROM A REAL PER-PERSON COUNT so figures are stable per agent rather
 * than reshuffling on every reload. A figure that changes on refresh reads as live
 * telemetry. It is still invented; the caption is what makes that legible.
 */
export function buildAgentPerformance(
  members: { id: string; name: string; roleLabel: string | null; openCount: number }[]
): AgentPerformanceView {
  const rows: AgentRow[] = members.map((m, i) => {
    const tickets = 40 + ((i * 17 + m.openCount * 3) % 60);
    const resolved = Math.max(0, tickets - ((i * 5 + m.openCount) % 9));
    const csat = Number((4.2 + ((i * 3) % 7) / 10).toFixed(1));

    // Adherence follows the one REAL signal available: someone carrying more open
    // work than they are closing is "behind". Keeps the mocked column at least
    // directionally honest against data we do have.
    const cadence: AgentCadence =
      m.openCount >= 5 ? 'behind' : m.openCount <= 1 ? 'ahead' : 'on_track';

    return {
      personId: m.id,
      name: m.name,
      roleLabel: m.roleLabel,
      tickets,
      resolved,
      csat,
      cadence
    };
  });

  return { figuresAreSample: true, rows };
}
