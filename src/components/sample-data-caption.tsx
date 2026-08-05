/**
 * The caption that marks a surface as invented.
 *
 * ⚠️ ALWAYS RENDERED FROM THE DATA'S OWN `isSample` FLAG, never from a hardcoded
 * boolean in a component. When a real integration lands, the service flips one
 * field and the caption disappears everywhere at once — there is no second place
 * to remember.
 *
 * ⚠️ Not a toast, not a tooltip, not a dev-only banner: it has to survive a
 * SCREENSHOT. Someone will screenshot one of these pages for a stakeholder, and a
 * placeholder that looks like data is how a fabricated number gets quoted back at
 * the team as fact.
 *
 * ⚠️ Moved to `src/components` when My day became a third consumer — it was a
 * local export of the person profile's tab shell. Every mocked surface is listed
 * in docs/gaps.md.
 */
export function SampleDataCaption({
  what,
  className
}: {
  /** One clause naming WHY it is invented, e.g. "calendar integration is not built". */
  what: string;
  className?: string;
}) {
  return (
    <p className={className ?? 'text-muted-foreground mb-[10px] text-[11.5px]'}>
      <span className='text-warning-muted-foreground font-semibold'>Sample data</span> — {what}
    </p>
  );
}
