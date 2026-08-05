'use client';

import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Screen } from '@/components/ui/panel';
import { personProfileOptions } from '../api/queries';
import { ActivityStrip } from './activity-strip';
import { AiSummaryCard } from './ai-summary-card';
import { ProfileHeader } from './profile-header';
import { ProfileTabs } from './profile-tabs';

export function ProfileBody({
  personId,
  backHref,
  backLabel
}: {
  personId: string;
  backHref: string;
  backLabel: string;
}) {
  const { data: profile } = useSuspenseQuery(personProfileOptions(personId));

  /**
   * ⚠️ `now` resolved ONCE for the whole subtree.
   *
   * Overdue is a clock comparison; computing it per row would compare against a
   * different instant on the server than in the browser and mismatch on the
   * boundary, which discards the subtree. Same rule as the tracker board.
   */
  const now = useMemo(() => new Date(), []);

  if (!profile) return null;

  return (
    // `narrow` — 1080px, the mockup's cap for the person profile. A detail view
    // reads as a column; the Control Tower gets 1180px because it is a grid.
    <Screen width='narrow'>
      <ProfileHeader profile={profile} backHref={backHref} backLabel={backLabel} />

      {/*
        ⚠️ KEPT, and placed here deliberately. The mockup's layout has no slot for
        a page-level AI summary, and the brief's constraint is explicit: this
        card's two-gate cache (input_hash, then TTL), its stale-over-empty
        fallback, its zero-data code guard and its double labelling are all
        load-bearing. Dropping it to match the mockup would delete the one
        component on this page designed against a billing incident.

        Under the signal cards, above the tabs: it answers all three chase
        questions at once, so it belongs before the reader starts drilling.
      */}
      <AiSummaryCard
        personId={profile.person.id}
        personName={profile.person.name}
        summary={profile.summary}
        unavailable={profile.summaryUnavailable}
      />

      {/*
        ⚠️ ALSO KEPT, though the mockup does not show it. The strip distinguishes
        "no linked accounts" from "no recent events" — a fact about OUR data with
        a fix the reader can act on, versus a fact about the person. Most of the
        roster is in the first state, and collapsing the two hides a task.
      */}
      <ActivityStrip
        events={profile.events}
        gap={profile.activityGap}
        personName={profile.person.name}
      />

      <ProfileTabs profile={profile} now={now} />
    </Screen>
  );
}
