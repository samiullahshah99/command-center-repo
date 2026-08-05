/**
 * A department's accent colour — the 8px dot beside its name in the sidebar.
 *
 * ⚠️ PURE, and no `server-only` marker: the sidebar's client half renders these,
 * and it is unit-testable for the same reason. No `db`, no clock, no randomness.
 *
 * ⚠️ RETURNS A TOKEN REFERENCE, NEVER A COLOUR. `var(--chart-3)` follows the
 * active theme through light and dark; a hex would be right in one mode and
 * wrong in the other, which is exactly the failure the theme adoption existed to
 * remove. Whoever adds a department gets a themed colour with no palette edit.
 */

/**
 * The chart ramp, which every theme in src/styles/themes defines in both modes.
 *
 * ⚠️ Chart tokens rather than a bespoke department palette: they are the only
 * multi-hue, theme-aware set the design system already ships. A new
 * `--dept-1..n` family would need adding to all eleven theme files, in two modes
 * each, to solve a problem that is already solved.
 */
const ACCENT_TOKENS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)'
] as const;

export const DEPT_ACCENT_COUNT = ACCENT_TOKENS.length;

/**
 * FNV-1a, 32-bit. A tiny, well-defined string hash.
 *
 * ⚠️ The point is STABILITY, not distribution quality. A department must keep the
 * same dot colour across reloads, across processes, and between server and
 * client — anything seeded by insertion order, array index or a clock would let
 * the colour move, and a dot that changes colour reads as a state change on a
 * screen whose whole job is signalling state.
 *
 * Hashing the id rather than the name also means renaming a department does not
 * recolour it.
 */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    // 16777619, via shifts — Math.imul keeps this in 32-bit space.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Stable accent token for a department id.
 *
 * Collisions are possible and acceptable: with five tokens and four departments
 * two may share a colour. The dot is a recognition aid beside a name that is
 * already there, not an identifier — and the alternative (assigning by index)
 * reshuffles every colour the moment a department is added or removed.
 */
export function departmentAccentVar(departmentId: string): string {
  return ACCENT_TOKENS[fnv1a(departmentId) % ACCENT_TOKENS.length];
}
