/**
 * Stable per-person avatar tint.
 *
 * ⚠️ PURE and client-safe — no `db`, no clock, no randomness. Sits beside
 * `@/lib/dept-accent`, which does the same job for departments.
 *
 * ⚠️ MOVED HERE ON ITS THIRD CONSUMER. It lived in the person profile's constants
 * and was duplicated once into My team with a note saying "two copies is the point
 * at which to notice, not yet to act". The department page is the third, so it
 * moved — CLAUDE.md: shared behaviour belongs in src/lib, not in an import between
 * features. Both old call sites now import from here.
 *
 * ⚠️ HASHES THE PERSON'S ID, NOT THEIR NAME. An id never changes, so correcting a
 * spelling cannot recolour someone. That was the specific objection recorded on
 * `InitialsAvatar` in @/components/ui/panel, and hashing the id answers it.
 *
 * ⚠️ RETURNS A TOKEN REFERENCE, NEVER A COLOUR. `var(--chart-2)` follows the active
 * theme through light and dark; a hex would be right in one mode and wrong in the
 * other, which is the bug the theme adoption removed everywhere else.
 *
 * FNV-1a, matching @/lib/dept-accent — deliberately a separate function rather
 * than a shared generic: a person is not a department, and the two palettes may
 * diverge without either dragging the other.
 */
export function personAccentVar(personId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < personId.length; i += 1) {
    hash ^= personId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `var(--chart-${(hash % 5) + 1})`;
}
