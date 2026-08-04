'use client';

import { useAppForm, useFormFields } from '@/components/ui/tanstack-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createPersonMutation, updatePersonMutation } from '../api/mutations';
import { roleProfileOptionsQuery } from '../api/queries';
import type { PersonRow } from '../api/types';
import { personFormSchema, type PersonFormValues } from '../schemas/person';

// Hoisted out of onSubmit: '' -> null so an unmapped id stays NULL in Postgres
// rather than becoming an empty string, which would break `WHERE ... IS NULL`.
function orNull(v: string) {
  return v.trim() === '' ? null : v.trim();
}

export default function PersonForm({
  initialData,
  pageTitle
}: {
  initialData: PersonRow | null;
  pageTitle: string;
}) {
  const router = useRouter();
  const isEdit = !!initialData;

  const { data: roleProfileOptions } = useSuspenseQuery(roleProfileOptionsQuery());

  const createMutation = useMutation({
    ...createPersonMutation,
    onSuccess: () => {
      toast.success('Person created successfully');
      router.push('/dashboard/people');
    },
    onError: () => toast.error('Failed to create person')
  });

  const updateMutation = useMutation({
    ...updatePersonMutation,
    onSuccess: () => {
      toast.success('Person updated successfully');
      router.push('/dashboard/people');
    },
    onError: () => toast.error('Failed to update person')
  });

  const form = useAppForm({
    defaultValues: {
      name: initialData?.name ?? '',
      roleProfileId: initialData?.roleProfileId ?? ''
    } as PersonFormValues,
    validators: {
      // Reused from the DB-level insertPersonSchema — see schemas/person.ts.
      onSubmit: personFormSchema
    },
    onSubmit: ({ value }) => {
      const payload = {
        name: value.name.trim(),
        roleProfileId: orNull(value.roleProfileId)
      };

      if (isEdit) {
        updateMutation.mutate({ id: initialData.id, values: payload });
      } else {
        createMutation.mutate(payload);
      }
    }
  });

  const { FormTextField, FormSelectField } = useFormFields<PersonFormValues>();

  const profileChoices = [{ value: '', label: 'Unassigned' }, ...roleProfileOptions];

  return (
    <Card className='mx-auto w-full'>
      <CardHeader>
        <CardTitle className='text-left text-2xl font-bold'>{pageTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        <form.AppForm>
          <form.Form className='space-y-8'>
            <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
              <FormTextField name='name' label='Name' required placeholder='Enter name' />

              <FormSelectField
                name='roleProfileId'
                label='Role Profile'
                options={profileChoices}
                placeholder='Select a role profile'
                description='Leave unassigned if no profile applies yet.'
              />
            </div>

            {/*
              Identity fields intentionally absent.

              They wrote person.slack_id / clickup_id / portal_id, which cannot
              express WHICH system an id belongs to and cannot hold two accounts
              for one source. `person_identity` supersedes them on the PAIR
              (source, external_id) with a confidence tier, and linking happens at
              /dashboard/identities where that provenance is recorded. Typing an
              id here would have created a second, unreconciled representation.
            */}

            <div className='flex justify-end gap-2'>
              <Button type='button' variant='outline' onClick={() => router.back()}>
                Back
              </Button>
              <form.SubmitButton>{isEdit ? 'Update Person' : 'Add Person'}</form.SubmitButton>
            </div>
          </form.Form>
        </form.AppForm>
      </CardContent>
    </Card>
  );
}
