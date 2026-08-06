import PageContainer from '@/components/layout/page-container';
import { Panel, Screen } from '@/components/ui/panel';
import { requireRouteAccess } from '@/lib/current-actor';

export const metadata = { title: 'Agency reporting' };

/**
 * Agency reporting — a PREVIEW, not a feature.
 *
 * ⚠️⚠️ NO DATA, NO MOCKS, NO SAMPLE ROWS. §2.15 is 0✅ / 0🟡 / 5🔴 — the audit's
 * own words are "Nothing in the backend supports this screen". There is no agency
 * model, no Klaviyo code, no Slack posting path and no capture watcher, so nothing
 * here could be rendered as data without inventing it outright.
 *
 * ⚠️ NO OVERDUE BANNER and no "Post in Slack" button. Both appear in the mockup and
 * both would be live-looking controls over machinery that does not exist — the
 * button in particular would be a no-op that reads as a failed send.
 *
 * ⚠️ NO CLOCK, no query, no service. This page renders static prose.
 */
export default async function Page() {
  // Resource-based check per CLAUDE.md — src/proxy.ts matches /dashboard(.*), but
  // createRouteMatcher is deprecated and can diverge from how Next.js routes.
  // ⚠️ Role gate + auth in one call. Redirects to the caller's own role home
  // rather than 403ing; the map is @/lib/route-access.
  await requireRouteAccess('/dashboard/reporting');

  return (
    <PageContainer
      pageTitle='Agency reporting'
      pageDescription='Required reports, captured updates and API metrics, per agency.'
    >
      <Screen width='narrow'>
        <Panel title='Reporting status'>
          <p className='text-muted-foreground text-[12.5px] leading-[1.6]'>
            Which agency owes which report, and whether it has landed — read from the updates each
            agency posts in its own Slack channel.
          </p>
        </Panel>

        <Panel title='Metrics'>
          <p className='text-muted-foreground text-[12.5px] leading-[1.6]'>
            Campaign and flow performance pulled from Klaviyo, alongside the reported numbers so the
            two can be compared rather than taken on trust.
          </p>
        </Panel>

        <Panel title='Ongoing strategies'>
          <p className='text-muted-foreground text-[12.5px] leading-[1.6]'>
            What each agency says it is currently working on, parsed from those same Slack updates
            into something readable at a glance.
          </p>
        </Panel>

        <Panel title='Where it sits'>
          <p className='text-muted-foreground text-[12.5px] leading-[1.6]'>
            <span className='text-foreground font-semibold'>
              Phase 5 — remaining net-new models
            </span>{' '}
            (<span className='font-mono text-[12px]'>docs/backend-audit.md §2.15</span>). All five
            elements are 🔴: the agency entity, the report requirement and its Slack post, Klaviyo
            metrics, the capture log, and strategy parsing. This is the largest single block of
            net-new work in the contract, and the audit names it as the screen to defer if the
            delivery is tight.
          </p>
          {/*
            ⚠️ TWO CONSTRAINTS THAT ARE EASY TO LOSE, both cheap to honour now and
            expensive later. The second especially: a separate agency extractor would
            leave `pnpm eval:extraction` measuring one path while appearing to cover
            extraction as a whole.
          */}
          <p className='text-muted-foreground border-t pt-[10px] text-[11.5px] leading-[1.5]'>
            <span className='text-success-muted-foreground font-semibold'>Partly de-risked</span> —
            Slack events are already stored workspace-wide and the architecture forbids
            channel-prefix filtering at ingest, so the raw material for the capture log is already
            landing.{' '}
            <span className='text-warning-muted-foreground font-semibold'>
              Strategy parsing must reuse the one extraction path
            </span>{' '}
            — a second path is a design failure, not a shortcut.
          </p>
        </Panel>
      </Screen>
    </PageContainer>
  );
}
