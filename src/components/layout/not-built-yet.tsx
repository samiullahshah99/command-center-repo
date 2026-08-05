import { Icons } from '@/components/icons';

/**
 * The body of a routed-but-unbuilt screen.
 *
 * ⚠️ THESE EXIST SO THE NAV CANNOT 404. The sidebar now renders the full mockup
 * IA, and most of those screens are not built — a nav item that 404s reads as
 * broken and gets filed as a bug, while one that says "not built yet" reads as a
 * roadmap. That is the only reason these pages exist.
 *
 * ⚠️ DELIBERATELY EMPTY OF FAKE DATA. No sample rows, no placeholder charts, no
 * greyed-out skeleton implying something is loading. A mocked-up screen in the
 * real app is indistinguishable from a working one to anyone who did not build
 * it, and the first person to quote a number off a placeholder has been misled by
 * us. `docs/backend-audit.md` records what each of these needs.
 */
export function NotBuiltYet({
  /** What has to land first, in one short phrase. */
  needs,
  /** Audit section that scoped it, e.g. '§2.10'. */
  auditRef
}: {
  needs: string;
  auditRef?: string;
}) {
  return (
    <div className='border-border flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center'>
      <Icons.info className='text-muted-foreground size-5' aria-hidden />
      <p className='text-foreground text-sm font-medium'>Not built yet</p>
      <p className='text-muted-foreground max-w-md text-[13px]'>
        {needs}
        {auditRef ? (
          <>
            {' '}
            Scoped in{' '}
            <span className='font-mono text-[12px]'>docs/backend-audit.md {auditRef}</span>.
          </>
        ) : null}
      </p>
    </div>
  );
}
