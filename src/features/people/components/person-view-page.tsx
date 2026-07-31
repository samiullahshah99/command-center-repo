'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import { personByIdOptions } from '../api/queries';
import type { PersonRow } from '../api/types';
import PersonForm from './person-form';
import { PersonIdentitiesCard } from '@/features/identities/components/person-identities-card';

type PersonViewPageProps = {
  personId: string;
};

export default function PersonViewPage({ personId }: PersonViewPageProps) {
  if (personId === 'new') {
    return <PersonForm initialData={null} pageTitle='Add New Person' />;
  }

  return <EditPersonView personId={personId} />;
}

function EditPersonView({ personId }: { personId: string }) {
  const { data } = useSuspenseQuery(personByIdOptions(personId));

  if (!data?.success || !data?.person) {
    notFound();
  }

  return (
    <div className='space-y-6'>
      <PersonForm initialData={data.person as PersonRow} pageTitle='Edit Person' />
      {/* Only on an existing person — a new one has no identities to show. */}
      <PersonIdentitiesCard personId={personId} />
    </div>
  );
}
