/**
 * Top bar — the SERVER half.
 *
 * Resolves the actor so the copilot affordance can be role-gated before any
 * markup exists, then hands a plain `variant` to the client half. Same reasoning
 * as ./app-sidebar.tsx, and `getCurrentActor()` is memoised per request, so the
 * sidebar and this bar share ONE resolution.
 */

import { COPILOT_ROLES } from '@/config/nav-config';
import { getCurrentActor } from '@/lib/current-actor';
import { HeaderBar, type CopilotVariant } from './header-bar';

export default async function Header() {
  const actor = await getCurrentActor();
  const roleCode = actor?.roleCode ?? null;

  /**
   * ⚠️ DENY BY DEFAULT, matching the nav. A null roleCode gets `none` — the same
   * treatment as `agency` — because AI search is gated to the six non-agency
   * roles and an unlinked actor holds none of them. An "Ask the AI brain" button
   * routing somewhere the actor cannot open is a dead end that reads as a broken
   * link rather than as a permission boundary.
   */
  const copilot: CopilotVariant =
    roleCode === null || roleCode === 'agency'
      ? 'none'
      : (COPILOT_ROLES as readonly string[]).includes(roleCode)
        ? 'input'
        : 'button';

  return <HeaderBar copilot={copilot} />;
}
