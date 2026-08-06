import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import PageContainer from '@/components/layout/page-container';
import { Icons } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { Panel, Screen } from '@/components/ui/panel';

export const metadata = { title: 'Company AI brain' };

/**
 * Company AI brain — a PREVIEW, not a feature.
 *
 * ⚠️⚠️ NO DATA, NO MOCKS, NO SAMPLE ROWS, AND DELIBERATELY NO EXAMPLE Q&A.
 * §2.9 is 0✅ / 0🟡 / 3🔴 — there is no retrieval layer, no index and no
 * embeddings, so nothing on this page could be answered.
 *
 * ⚠️ THE MOCKUP'S EXAMPLE QUESTION-AND-ANSWER IS NOT RENDERED. It is the most
 * dangerous element in the whole mockup set: a plausible answer with plausible
 * citations, sitting in the real app, is indistinguishable from working search to
 * anyone who did not build it — and unlike a fabricated number, a fabricated
 * CITATION invents a source that was never consulted, which is the one output an
 * AI feature must never produce. No caption makes that safe, so it is absent
 * rather than labelled.
 *
 * ⚠️ NO CLOCK, no query, no service. This page renders static prose.
 */
export default async function Page() {
  // Resource-based check per CLAUDE.md — src/proxy.ts matches /dashboard(.*), but
  // createRouteMatcher is deprecated and can diverge from how Next.js routes.
  const { userId } = await auth();
  if (!userId) redirect('/auth/sign-in');

  return (
    <PageContainer
      pageTitle='Company AI brain'
      pageDescription='Ask across the portal, meeting transcripts, Slack and Notion.'
    >
      <Screen width='narrow'>
        {/*
          ⚠️ DISABLED, not merely inert. An enabled box that silently swallows a
          question is worse than no box: someone types, waits, and concludes the
          product is broken. `disabled` also takes it out of the tab order, so it
          cannot be reached by keyboard either.
        */}
        <div className='relative'>
          <Icons.search
            className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 opacity-50'
            aria-hidden
          />
          <Input
            disabled
            aria-label='Company AI brain search — not yet available'
            placeholder='Coming soon — role-scoped answers from the portal, meetings, Slack and Notion'
            className='h-11 pl-9'
          />
        </div>

        <Panel title='What this will do'>
          <ul className='text-muted-foreground flex flex-col gap-[9px] text-[12.5px] leading-[1.55]'>
            <li>
              <span className='text-foreground font-semibold'>Cited answers.</span> Every answer
              lists the sources it was drawn from, so a claim can be checked rather than trusted.
            </li>
            <li>
              <span className='text-foreground font-semibold'>
                Scoped to the asker&rsquo;s role at the retrieval layer.
              </span>{' '}
              Sources are filtered by role <em>before</em> an answer is generated — not hidden in
              the UI afterwards. A UI filter still sends the restricted material to the model, and
              still lets it surface in the prose.
            </li>
            <li>
              <span className='text-foreground font-semibold'>One corpus, four systems.</span> The
              portal&rsquo;s own records, meeting transcripts, Slack and Notion.
            </li>
          </ul>
        </Panel>

        <Panel title='Where it sits'>
          <p className='text-muted-foreground text-[12.5px] leading-[1.6]'>
            <span className='text-foreground font-semibold'>Phase 4 — the retrieval layer</span> (
            <span className='font-mono text-[12px]'>docs/backend-audit.md §2.9</span>). No index, no
            embeddings and no retrieval layer exist yet, and the Notion client is unbuilt —{' '}
            <span className='font-mono text-[12px]'>pnpm verify:notion</span> is a credential check,
            not a client.
          </p>
          {/*
            ⚠️ THE ORDERING CONSTRAINT IS THE POINT OF THIS PARAGRAPH, not a caveat
            appended to it. Audit D1 calls role-filtered retrieval an
            index-partitioning decision: getting it wrong means a re-index, not a
            patch. The role model itself landed in Phase 0, so this is no longer
            blocked on the role concept — only on the partitioning decision.
          */}
          <p className='text-muted-foreground border-t pt-[10px] text-[11.5px] leading-[1.5]'>
            <span className='text-warning-muted-foreground font-semibold'>
              Decide before indexing
            </span>{' '}
            — role-filtered retrieval is an index-partitioning decision (audit D1) and cannot be
            retrofitted cheaply. The role model itself now exists, so the open question is the
            partitioning, not the roles.
          </p>
        </Panel>
      </Screen>
    </PageContainer>
  );
}
