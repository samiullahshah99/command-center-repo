import { windowEndFor, windowStartFor } from '@/lib/completion-window';
import type { Cadence } from '@/db/schema/recurring-task';

/**
 * THE WINDOW-CLOSING SWEEP.
 *
 * ⚠️⚠️ IT WRITES NOTHING. Not to `completion_event`, not anywhere. Design §1 is
 * explicit that the sweep must NOT "catch up" completions by re-scanning events:
 * if the reaction path missed one, that is a bug to fix, and a sweep that silently
 * repairs the reactor is a sweep that HIDES the reactor being broken.
 *
 * ⚠️ SO WHY DOES IT EXIST AT ALL? Because "did this NOT get done?" cannot be
 * answered by reacting to events — absence emits nothing. The sweep's product is
 * the *knowledge that a window has closed*, which is what turns "no completion row
 * yet" into `window_closed_unmet` rather than `awaiting_signal`.
 *
 * ⚠️ MISSED STATE IS DERIVED, NOT MATERIALISED — and that is a deliberate choice
 * worth defending. Writing a "missed" row into `completion_event` would put a
 * NON-completion into the completion ledger, where every existing consumer counts
 * rows to mean "done". `absence + closed window` is computable from data we
 * already have (`isWindowClosed()` below plus a NOT EXISTS), costs no table, and
 * cannot be mistaken for a completion by a query nobody has written yet.
 *
 * The consequence: the sweep is a pure function of the clock, so it needs no
 * schedule to be CORRECT — the schedule only bounds how stale a UI's notion of
 * "closed" can be if it caches. It is therefore trivially idempotent, and safe to
 * run on two containers, which is the deployment reality (workers boot in-process
 * from `src/instrumentation.ts`, once per process).
 */

/**
 * Has the window containing `windowStart` ended, as of `now`?
 *
 * Boundaries follow `COMPLETION_TZ` (Asia/Karachi), like every other window
 * calculation — see the header of `src/lib/completion-window.ts` for why this
 * deliberately differs from dept-health's UTC convention.
 */
export function isWindowClosed(
  cadence: Cadence,
  windowStart: string,
  now: Date,
  taskCreatedAt?: Date
): boolean {
  return now.getTime() >= windowEndFor(cadence, windowStart, taskCreatedAt).getTime();
}

/** The window a task is currently in, for `now`. */
export function currentWindowStart(cadence: Cadence, now: Date, taskCreatedAt?: Date): string {
  return windowStartFor(cadence, now, taskCreatedAt);
}

export type SweepSummary = {
  /** Windows observed as closed. Reported, never written. */
  closed: number;
  /** ⚠️ Always 0. Present so a caller cannot assume the sweep writes. */
  written: 0;
  ranAt: string;
};

/**
 * Run the sweep.
 *
 * ⚠️ `now` IS A PARAMETER, resolved once by the caller — the same rule every
 * service on this codebase follows, and what makes the sweep testable without a
 * clock.
 *
 * ⚠️ THE RETURN VALUE IS A REPORT, NOT A MUTATION RECEIPT. `written` is typed as
 * the literal `0` so that a future change trying to make the sweep write has to
 * change the type, and therefore has to read this comment.
 */
export async function runCompletionSweep(input: {
  now: Date;
  tasks: { id: string; cadence: Cadence; createdAt: Date | null }[];
}): Promise<SweepSummary> {
  let closed = 0;

  for (const task of input.tasks) {
    /**
     * The window that has just ended is the one BEFORE the current one. Checking
     * the current window would always report "open", since by definition `now` is
     * inside it.
     */
    const current = currentWindowStart(task.cadence, input.now, task.createdAt ?? undefined);
    const previousInstant = new Date(
      windowEndFor(task.cadence, current, task.createdAt ?? undefined).getTime() - 1
    );
    const previous = windowStartFor(
      task.cadence,
      new Date(previousInstant.getTime() - windowSpanMs(task.cadence)),
      task.createdAt ?? undefined
    );

    if (isWindowClosed(task.cadence, previous, input.now, task.createdAt ?? undefined)) {
      closed += 1;
    }
  }

  return { closed, written: 0, ranAt: input.now.toISOString() };
}

/** Rough span used only to step back one window; exact boundaries come from windowEndFor. */
function windowSpanMs(cadence: Cadence): number {
  const DAY = 86_400_000;
  switch (cadence) {
    case 'daily':
      return DAY;
    case 'weekly':
      return 7 * DAY;
    case 'biweekly':
      return 14 * DAY;
    case 'monthly':
      return 31 * DAY;
    case 'quarterly':
      return 93 * DAY;
  }
}
