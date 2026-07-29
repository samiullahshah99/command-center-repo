'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import { roleProfileByIdOptions } from '../api/queries';
import type { RoleProfileRow } from '../api/types';
import RoleProfileForm from './role-profile-form';

type RoleProfileViewPageProps = {
  roleProfileId: string;
};

export default function RoleProfileViewPage({ roleProfileId }: RoleProfileViewPageProps) {
  if (roleProfileId === 'new') {
    return <RoleProfileForm initialData={null} pageTitle='Create New Role Profile' />;
  }

  return <EditRoleProfileView roleProfileId={roleProfileId} />;
}

function EditRoleProfileView({ roleProfileId }: { roleProfileId: string }) {
  const { data } = useSuspenseQuery(roleProfileByIdOptions(roleProfileId));

  if (!data?.success || !data?.roleProfile) {
    notFound();
  }

  return (
    <RoleProfileForm
      initialData={data.roleProfile as RoleProfileRow}
      pageTitle='Edit Role Profile'
    />
  );
}
