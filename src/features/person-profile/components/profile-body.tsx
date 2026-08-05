'use client';

import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Panel, Screen } from '@/components/ui/panel';
import { personProfileOptions } from '../api/queries';
import { ActivityStrip } from './activity-strip';
import { AiSummaryCard } from './ai-summary-card';
import { ProfileHeader } from './profile-header';
import { ProfileItemList } from './profile-item-list';

export function ProfileBody({ personId }: { personId: string }) {
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
    // `narrow` — the mock caps the person profile at 1080px rather than the
    // 1180px it gives the Control Tower. A detail view reads as a column.
    <Screen width='narrow'>
      <ProfileHeader profile={profile} />

      {/* The AI layer above the list: the ask was "leadership stops chasing",
          and the summary is the thing that answers all three questions at once. */}
      <AiSummaryCard
        personId={profile.person.id}
        personName={profile.person.name}
        summary={profile.summary}
        unavailable={profile.summaryUnavailable}
      />

      <ActivityStrip
        events={profile.events}
        gap={profile.activityGap}
        personName={profile.person.name}
      />

      <Panel
        title='Assigned work'
        meta={`${profile.counts.total} item${profile.counts.total === 1 ? '' : 's'} · grouped by status`}
      >
        <ProfileItemList items={profile.items} now={now} />
      </Panel>
    </Screen>
  );
}
