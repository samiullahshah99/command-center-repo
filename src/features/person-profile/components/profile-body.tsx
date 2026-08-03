'use client';

import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
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
    <div className='flex flex-col gap-6'>
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

      <Card>
        <CardContent className='pt-6'>
          <h3 className='mb-1 text-sm font-semibold'>Assigned work</h3>
          <p className='text-muted-foreground mb-3 text-xs'>
            {profile.counts.total} item{profile.counts.total === 1 ? '' : 's'} · grouped by status
          </p>
          <ProfileItemList items={profile.items} now={now} />
        </CardContent>
      </Card>
    </div>
  );
}
